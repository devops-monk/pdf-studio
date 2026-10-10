// Resolves download buttons to the latest GitHub release and recommends the
// visitor's platform. Every link already works without JavaScript (it points
// to the releases page), so failures here are harmless.
;(function () {
  document.documentElement.classList.add('js')

  var REPO = 'devops-monk/pdf-studio'

  function detectOs() {
    var p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase()
    if (p.indexOf('mac') >= 0 || p.indexOf('iphone') >= 0 || p.indexOf('ipad') >= 0) return 'mac'
    if (p.indexOf('win') >= 0) return 'win'
    if (p.indexOf('linux') >= 0 || p.indexOf('x11') >= 0 || p.indexOf('cros') >= 0) return 'linux'
    return null
  }

  var os = detectOs()
  var labels = { mac: 'Download for Mac', win: 'Download for Windows', linux: 'Download for Linux' }
  var primaryAsset = { mac: 'mac-arm64.dmg', win: 'win-x64.exe', linux: 'linux-amd64.deb' }
  var primary = document.getElementById('primary-download')

  if (os) {
    primary.textContent = labels[os]
    var card = document.querySelector('.platform[data-os="' + os + '"]')
    if (card) card.classList.add('recommended')
  }

  function applyRelease(release) {
    var assets = release.assets || []
    var find = function (suffix) {
      for (var i = 0; i < assets.length; i++) if (assets[i].name.slice(-suffix.length) === suffix) return assets[i]
      return null
    }
    document.querySelectorAll('[data-asset]').forEach(function (a) {
      var asset = find(a.getAttribute('data-asset'))
      if (asset) {
        a.href = asset.browser_download_url
        a.title = asset.name + ' · ' + Math.round(asset.size / 1048576) + ' MB'
      }
    })
    var v = release.tag_name ? release.tag_name.replace(/^v/, '') : null
    if (v) {
      document.getElementById('release-version').textContent = 'Version ' + v
      document.getElementById('hero-meta').textContent = 'Free for Mac, Windows and Linux · Version ' + v
    }
    if (os) {
      var main = find(primaryAsset[os])
      if (main) primary.href = main.browser_download_url
    }
  }

  // Cache for an hour: GitHub's anonymous API allows 60 requests per hour per IP.
  var KEY = 'pdfstudio-release'
  try {
    var cached = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (cached && Date.now() - cached.at < 3600e3) applyRelease(cached.data)
  } catch (e) {}

  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) {
      return r.ok ? r.json() : null
    })
    .then(function (data) {
      if (!data) return
      applyRelease(data)
      try {
        localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data: { tag_name: data.tag_name, assets: data.assets.map(function (a) { return { name: a.name, size: a.size, browser_download_url: a.browser_download_url } }) } }))
      } catch (e) {}
    })
    .catch(function () {})

  // Gentle reveal for sections as they scroll into view.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        })
      },
      { rootMargin: '0px 0px -10% 0px' }
    )
    document.querySelectorAll('.feature, .tile, .privacy-grid, .platform').forEach(function (el) {
      el.classList.add('reveal')
      io.observe(el)
    })
  }
})()

// Floating download dock: appears once the hero's button scrolls away, and
// hides again over the download section.
;(function () {
  var dock = document.getElementById('dock')
  var primary = document.getElementById('primary-download')
  var dockBtn = document.getElementById('dock-download')
  var section = document.getElementById('download')
  if (!dock || !('IntersectionObserver' in window)) return
  var heroVisible = true
  var downloadVisible = false
  var update = function () {
    dock.classList.toggle('show', !heroVisible && !downloadVisible)
    dockBtn.textContent = primary.textContent
    dockBtn.href = primary.href
    var meta = document.getElementById('hero-meta')
    if (meta && meta.textContent.indexOf('Version') >= 0) document.getElementById('dock-meta').textContent = 'Free · ' + meta.textContent.split('· ')[1]
  }
  new IntersectionObserver(function (e) {
    heroVisible = e[0].isIntersecting
    update()
  }).observe(primary)
  new IntersectionObserver(function (e) {
    downloadVisible = e[0].isIntersecting
    update()
  }, { threshold: 0.15 }).observe(section)
})()
