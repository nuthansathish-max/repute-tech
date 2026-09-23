(() => {
  const escStaff = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));

  async function staffApi(path, options = {}) {
    const response = await fetch('/api' + path, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || 'Request failed');
    return data;
  }

  async function loadStaff() {
    const businessId = window.businessId;
    const list = document.getElementById('staffList');
    if (!businessId || !list) return;

    try {
      const rows = await staffApi('/businesses/' + encodeURIComponent(businessId) + '/staff');
      list.innerHTML = (Array.isArray(rows) ? rows : []).map(row =>
        '<div class="item">' +
          '<b>' + escStaff(row.name || row.email || 'Staff member') + '</b>' +
          '<div class="sub">' + escStaff(row.email || '') + ' · ' + escStaff(row.role || 'STAFF') + '</div>' +
        '</div>'
      ).join('') || '<div class="sub">No staff members yet.</div>';
    } catch (error) {
      list.innerHTML = '<div class="notice">' + escStaff(error.message) + '</div>';
    }
  }

  async function submitStaff() {
    const emailInput = document.getElementById('staffEmail');
    const roleInput = document.getElementById('staffRole');
    const message = document.getElementById('staffMsg');
    const button = document.getElementById('staffAddButton');
    const businessId = window.businessId;

    if (!emailInput || !roleInput || !message) return;

    const email = String(emailInput.value || '').trim();
    const role = String(roleInput.value || 'STAFF').trim().toUpperCase();

    message.textContent = '';

    if (!email) {
      message.textContent = 'Enter the staff member email';
      emailInput.focus();
      return;
    }

    if (!businessId) {
      message.textContent = 'Business is still loading. Please try again.';
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = 'Adding…';
    }

    try {
      await staffApi('/businesses/' + encodeURIComponent(businessId) + '/staff', {
        method: 'POST',
        body: JSON.stringify({ email: email, role: role })
      });

      message.textContent = 'Staff member added successfully.';
      emailInput.value = '';
      await loadStaff();
    } catch (error) {
      message.textContent = error.message || 'Unable to add staff member.';
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Add staff';
      }
    }
  }

  function bindStaffForm() {
    const form = document.getElementById('staffForm');
    const button = document.getElementById('staffAddButton');

    if (!form || !button || form.dataset.staffBound === '1') return;

    form.dataset.staffBound = '1';

    // Explicitly prevent the browser from submitting the form and navigating/reloading.
    form.addEventListener('submit', function(event) {
      event.preventDefault();
      event.stopPropagation();
      submitStaff();
    });

    button.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      submitStaff();
    });
  }

  window.loadStaff = loadStaff;

  function start() {
    bindStaffForm();
    loadStaff();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // The Staff section is a single-page view; re-bind whenever it is opened.
  document.addEventListener('click', function(event) {
    const nav = event.target.closest('[data-page="staff"]');
    if (!nav) return;
    setTimeout(function() {
      bindStaffForm();
      loadStaff();
    }, 50);
  });
})();
