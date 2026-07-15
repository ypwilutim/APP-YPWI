// site.js - Shared navigation & footer for public (verification) pages.
// Fetches business identity from /api/public/info and injects #site-nav and #site-footer.
(async function () {
  const navEl = document.getElementById('site-nav');
  const footerEl = document.getElementById('site-footer');

  const fallback = {
    name: 'YPWI Lutim',
    legal_name: 'Yayasan Pesantren Wahdah Islamiyah Luwu Timur',
    address: '',
    phone: '',
    whatsapp: '',
    email: 'admin@ypwilutim.com'
  };

  let info = fallback;
  try {
    const res = await fetch('/api/public/info');
    if (res.ok) {
      const j = await res.json();
      if (j.success && j.data) info = Object.assign({}, fallback, j.data);
    }
  } catch (e) {
    console.warn('Gagal memuat info bisnis:', e);
  }

  const waHref = info.whatsapp ? 'https://wa.me/' + info.whatsapp : '#';
  const telHref = info.phone ? 'https://wa.me/' + (info.whatsapp || info.phone) : '#';

  if (navEl) {
    navEl.innerHTML = `
      <nav class="site-nav-inner">
        <a class="brand" href="/landing.html">${info.name}</a>
        <button class="nav-toggle" aria-label="Menu">&#9776;</button>
        <div class="nav-links">
          <a href="/landing.html">Beranda</a>
          <a href="/produk.html">Biaya Pendidikan</a>
          <a href="/terms.html">Ketentuan</a>
          <a href="/privacy-policy.html">Privasi</a>
          <a class="nav-cta" href="/login.html">Masuk</a>
        </div>
      </nav>`;
    const toggle = navEl.querySelector('.nav-toggle');
    const links = navEl.querySelector('.nav-links');
    if (toggle && links) {
      toggle.addEventListener('click', () => links.classList.toggle('open'));
    }
  }

  if (footerEl) {
    footerEl.innerHTML = `
      <footer class="site-footer-inner">
        <div>
          <h3>${info.name}</h3>
          <p>${info.legal_name}</p>
        </div>
        <div>
          <h4>Kontak</h4>
          <p>${info.address ? 'Alamat: ' + info.address : ''}</p>
          <p>Telepon/WA: <a href="${telHref}">${info.phone ? '+' + info.phone.replace(/^0+/, '62') : '-'}</a></p>
          <p>Email: <a href="mailto:${info.email}">${info.email}</a></p>
        </div>
        <div>
          <h4>Tautan</h4>
          <p><a href="/landing.html">Beranda</a></p>
          <p><a href="/produk.html">Biaya Pendidikan</a></p>
          <p><a href="/terms.html">Ketentuan Layanan</a></p>
          <p><a href="/privacy-policy.html">Kebijakan Privasi</a></p>
        </div>
      </footer>
      <div class="site-footer-bottom">© ${new Date().getFullYear()} ${info.name}. Pembayaran diproses melalui Midtrans.</div>`;
  }
})();
