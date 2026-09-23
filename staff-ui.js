(() => {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));

  const permissionLabels = {
    DASHBOARD:'Dashboard',
    REVIEWS:'Reviews',
    AI:'AI Assistant',
    QR:'Smart QR',
    MENU:'Digital Menu',
    CUSTOMERS:'Customers',
    WHATSAPP:'WhatsApp',
    ANALYTICS:'Analytics',
    BILLING:'Billing & POS',
    ORDERS:'Orders',
    PRICING:'Plans & Pricing',
    STAFF:'Staff Management',
    SETTINGS:'Account Settings'
  };

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
      const isOwner = String(window.currentUser?.role || '').toUpperCase() === 'OWNER';

      list.innerHTML = (Array.isArray(rows) ? rows : []).map(row => {
        const permissions = row.permissions || {};
        const permissionEditor = isOwner ? (
          '<div class="staff-permission-box" data-permission-box="' + esc(row.id) + '" style="display:none;margin-top:10px;padding:12px;border:1px solid #e6e8ef;border-radius:10px;background:#fafbff">' +
            '<div class="section-title" style="font-size:14px">Access permissions</div>' +
            '<div class="sub" style="margin-bottom:8px">Choose exactly what this ' + esc(row.role) + ' can access.</div>' +
            '<div class="staff-permission-grid">' +
              Object.keys(permissionLabels).map(key =>
                '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px">' +
                '<input type="checkbox" data-permission="' + key + '"' + (permissions[key] === true ? ' checked' : '') + '>' +
                '<span>' + permissionLabels[key] + '</span></label>'
              ).join('') +
            '</div>' +
            '<button class="btn" type="button" data-save-permissions="' + esc(row.id) + '" style="margin-top:8px">Save permissions</button>' +
            '<span class="sub" data-permission-msg="' + esc(row.id) + '" style="margin-left:8px"></span>' +
          '</div>'
        ) : '';

        return '<div class="item">' +
          '<b>' + esc(row.name || row.email || 'Staff member') + '</b>' +
          '<div class="sub">' + esc(row.email || '') + ' · ' + esc(row.role || 'STAFF') + '</div>' +
          (isOwner ? '<div class="row" style="margin-top:8px"><button class="btn secondary" type="button" data-toggle-permissions="' + esc(row.id) + '">Permissions</button></div>' + permissionEditor : '') +
        '</div>';
      }).join('') || '<div class="sub">No staff members yet.</div>';

      if (isOwner) {
        list.querySelectorAll('[data-toggle-permissions]').forEach(button => {
          button.addEventListener('click', () => {
            const box = list.querySelector('[data-permission-box="' + button.dataset.togglePermissions + '"]');
            if (!box) return;
            const open = box.style.display !== 'none';
            box.style.display = open ? 'none' : 'block';
            button.textContent = open ? 'Permissions' : 'Hide permissions';
          });
        });

        list.querySelectorAll('[data-save-permissions]').forEach(button => {
          button.addEventListener('click', async () => {
            const id = button.dataset.savePermissions;
            const box = list.querySelector('[data-permission-box="' + id + '"]');
            const msg = list.querySelector('[data-permission-msg="' + id + '"]');
            if (!box) return;
            const permissions = {};
            box.querySelectorAll('[data-permission]').forEach(input => {
              permissions[input.dataset.permission] = input.checked;
            });
            button.disabled = true;
            button.textContent = 'Saving…';
            if (msg) msg.textContent = '';
            try {
              await staffApi('/businesses/' + encodeURIComponent(businessId) + '/staff/' + encodeURIComponent(id) + '/permissions', {
                method: 'PUT',
                body: JSON.stringify({ permissions })
              });
              if (msg) msg.textContent = 'Saved';
              await loadStaff();
            } catch (error) {
              if (msg) msg.textContent = error.message;
              button.disabled = false;
              button.textContent = 'Save permissions';
            }
          });
        });
      }
    } catch (error) {
      list.innerHTML = '<div class="notice">' + esc(error.message) + '</div>';
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
        body: JSON.stringify({ email, role })
      });

      message.textContent = 'Staff member added successfully. Now choose their permissions below.';
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
    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
      submitStaff();
    });
    button.addEventListener('click', event => {
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-page="staff"]');
    if (!nav) return;
    setTimeout(() => {
      bindStaffForm();
      loadStaff();
    }, 50);
  });
})();
