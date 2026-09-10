(() => {
  // Final review-action authority. This only normalizes the Review inbox actions.
  if (window.__reputeReviewFinalizer) return;
  window.__reputeReviewFinalizer = true;

  const list = () => document.getElementById('reviewsList');
  let timer = null;

  const makeButton = (text, className = 'btn') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    return b;
  };

  const actionRow = item => {
    let row = item.querySelector('.row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'row';
      row.style.cssText = 'margin-top:10px;flex-wrap:wrap';
      item.appendChild(row);
    }
    return row;
  };

  const removeReviewActions = row => {
    row.querySelectorAll('button').forEach(btn => {
      if (btn.hasAttribute('data-use-review')) return;
      const t = (btn.textContent || '').trim().toLowerCase();
      // Remove every legacy approve/publish variant, including old inline
      // buttons such as "Approve & Post to Google" that had no data attribute.
      if (t.includes('approve') || t.includes('publish to google') || t.includes('post to google') || t === 'publishing…' || t === 'publishing...') {
        btn.remove();
      }
    });
    row.querySelectorAll('[data-stable-review-action],[data-stable-approve],[data-stable-publish],[data-approve-review],[data-publish-review]').forEach(x => x.remove());
  };

  function normalize() {
    const reviewList = list();
    if (!reviewList) return;

    reviewList.querySelectorAll('.item').forEach(item => {
      const use = item.querySelector('[data-use-review]');
      if (!use) return;

      const pill = (item.querySelector('.pill')?.textContent || '').trim().toLowerCase();
      const row = actionRow(item);
      removeReviewActions(row);

      if (pill.includes('published to google')) {
        const b = makeButton('Published to Google', 'btn secondary');
        b.disabled = true;
        row.appendChild(b);
        return;
      }

      if (pill.includes('approved') || pill.includes('ready to publish')) {
        const b = makeButton('Publish to Google');
        b.dataset.finalPublish = use.dataset.useReview;
        row.appendChild(b);
        return;
      }

      if (pill.includes('pending approval')) {
        const b = makeButton('Approve Reply');
        b.dataset.finalApprove = use.dataset.useReview;
        row.appendChild(b);
        return;
      }

      // Leave non-review-action controls (for example Generate AI Reply)
      // alone when there is no approval state to normalize.
    });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(normalize, 80);
  }

  document.addEventListener('click', async e => {
    const approve = e.target.closest?.('[data-final-approve]');
    if (approve) {
      e.preventDefault();
      e.stopImmediatePropagation();
      approve.disabled = true;
      approve.textContent = 'Approving…';
      try {
        const r = await fetch(`/api/reviews/${encodeURIComponent(approve.dataset.finalApprove)}/approve`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        if (!r.ok) throw new Error((await r.text()) || `Approval failed (${r.status})`);
        if (typeof window.toast === 'function') window.toast('AI reply approved. It is now ready to publish to Google.');
        const reload = document.getElementById('loadReviews');
        if (reload) reload.click();
      } catch (err) {
        approve.disabled = false;
        approve.textContent = 'Approve Reply';
        if (typeof window.toast === 'function') window.toast(err.message || 'Approval failed'); else alert(err.message || 'Approval failed');
      }
      return;
    }

    const publish = e.target.closest?.('[data-final-publish]');
    if (publish) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!window.confirm('Publish this approved reply to Google Business Profile?\n\nThe reply will be posted publicly on Google.')) return;
      publish.disabled = true;
      publish.textContent = 'Publishing…';
      try {
        const r = await fetch(`/api/reviews/${encodeURIComponent(publish.dataset.finalPublish)}/publish`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true })
        });
        if (!r.ok) throw new Error((await r.text()) || `Publishing failed (${r.status})`);
        if (typeof window.toast === 'function') window.toast('Reply published to Google successfully.');
        const reload = document.getElementById('loadReviews');
        if (reload) reload.click();
      } catch (err) {
        publish.disabled = false;
        publish.textContent = 'Publish to Google';
        if (typeof window.toast === 'function') window.toast(err.message || 'Publishing failed'); else alert(err.message || 'Publishing failed');
      }
    }
  }, true);

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
})();
