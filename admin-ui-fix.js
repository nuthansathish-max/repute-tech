(() => {
  const $ = (id) => document.getElementById(id);

  function removeAdminSections() {
    const admin = $('admin');
    if (!admin) return;

    admin.querySelectorAll('.section-title').forEach((title) => {
      const text = String(title.textContent || '').trim();
      if (text === 'Plan catalog' || text === 'Pending plan requests') {
        const card = title.closest('.card');
        if (card) card.remove();
      }
    });
  }

  async function setBusinessName() {
    const value = $('adminBusinesses');
    if (!value) return false;

    try {
      const response = await fetch('/api/businesses', {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) return false;

      const businesses = await response.json();
      if (!Array.isArray(businesses) || !businesses.length) return false;

      const business = businesses[0];
      const label = value.closest('.metricgrid')?.querySelector('.label');
      if (label) label.textContent = 'Business';
      value.textContent = business.name || '—';
      return true;
    } catch {
      return false;
    }
  }

  function apply() {
    removeAdminSections();
    setBusinessName();
  }

  function start() {
    apply();

    const admin = $('admin');
    if (admin) {
      const observer = new MutationObserver(() => apply());
      observer.observe(admin, { childList: true, subtree: true });
    }

    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const done = await setBusinessName();
      removeAdminSections();
      if (done || attempts >= 20) clearInterval(timer);
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();