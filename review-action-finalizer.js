(() => {
  // The stable-action-controls.js module is the single authority for Review actions.
  // This compatibility file is intentionally inert so it cannot remove or replace
  // the stable Publish to Google button.
  if (window.__reputeReviewFinalizer) return;
  window.__reputeReviewFinalizer = true;
})();
