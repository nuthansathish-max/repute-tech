(() => {
  async function staffApi(path, opts = {}) {
    const r = await fetch('/api' + path, {
      credentials: 'include',
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  }

  async function loadStaff() {
    if (!window.businessId) return;
    const list = document.getElementById('staffList');
    if (!list) return;

    try {
      const rows = await staffApi(
        '/businesses/' + encodeURIComponent(window.businessId) + '/staff'
      );

      list.innerHTML =
        rows.map(x =>
          '<div class="item"><b>' + esc(x.name) + '</b>' +
          '<div class="sub">' + esc(x.email) + ' · ' + esc(x.role) + '</div>' +
          '<div class="row" style="margin-top:8px">' +
          '<button class="btn secondary" type="button" onclick="changeStaff(\\'' + x.id + '\\',\\'' + x.role + '\\')">Change role</button>' +
          '<button class="btn secondary" type="button" onclick="removeStaff(\\'' + x.id + '\\')">Remove</button>' +
          '</div></div>'
        ).join('') || '<div class="sub">No staff members yet.</div>';
    } catch (e) {
      list.innerHTML = '<div class="notice">' + esc(e.message) + '</div>';
    }
  }

  let submitting = false;

  window.addStaff = async function () {
    const msg = document.getElementById('staffMsg');
    const form = document.getElementById('staffForm');
    const emailInput = document.getElementById('staffEmail');
    const roleInput = document.getElementById('staffRole');
    const button = document.getElementById('staffAddButton');

    if (!form || !emailInput || !roleInput) return;

    msg.textContent = '';

    // Read the actual input value directly. Do not depend on FormData.
    const email = String(emailInput.value || '').trim();
    const role = String(roleInput.value || 'STAFF').toUpperCase();

    if (!email) {
      msg.textContent = 'Enter the staff member email';
      emailInput.focus();
      return;
    }

    if (submitting) return;

    submitting = true;
    button.disabled = true;

    try {
      await staffApi(
        '/businesses/' + encodeURIComponent(window.businessId) + '/staff',
        {
          method: 'POST',
          body: JSON.stringify({ email, role })
        }
      );

      msg.textContent = 'Staff member added.';
      form.reset();
      await loadStaff();
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      submitting = false;
      button.disabled = false;
    }
  };

  function bindStaffAdd() {
    const form = document.getElementById('staffForm');
    if (!form || form.dataset.bound === '1') return;

    form.dataset.bound = '1';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      window.addStaff();
    });
  }

  window.changeStaff = async function (id, current) {
    const role = prompt('Enter MANAGER or STAFF', current);
    if (!role) return;

    try {
      await staffApi(
        '/businesses/' + encodeURIComponent(window.businessId) + '/staff/' + encodeURIComponent(id),
        {
          method: 'PUT',
          body: JSON.stringify({ role })
        }
      );
      await loadStaff();
    } catch (e) {
      alert(e.message);
    }
  };

  window.removeStaff = async function (id) {
    if (!confirm('Remove this staff member from this business?')) return;

    try {
      await staffApi(
        '/businesses/' + encodeURIComponent(window.businessId) + '/staff/' + encodeURIComponent(id),
        { method: 'DELETE' }
      );
      await loadStaff();
    } catch (e) {
      alert(e.message);
    }
  };

  window.loadStaff = loadStaff;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindStaffAdd);
  } else {
    bindStaffAdd();
  }

  document.addEventListener('DOMContentLoaded', function () {
    const b = document.querySelector('[data-page="staff"]');
    if (b) {
      b.addEventListener('click', function () {
        setTimeout(function () {
          bindStaffAdd();
          loadStaff();
        }, 50);
      });
    }
  });
})();
