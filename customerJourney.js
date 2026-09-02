/**
 * repute-tech.in v1.5 - Customer Experience helpers.
 *
 * Mount this router in the main Express app with:
 *   app.use("/api/customer", customerJourneyRouter);
 *
 * The routes are deliberately provider-neutral. They work with the existing
 * QR/menu/customer models and do not expose private customer data publicly.
 */
import express from "express";
const router = express.Router();

function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "customer-journey", version: "1.5" });
});

/**
 * Customer feedback submission.
 * A real deployment should additionally apply CAPTCHA/rate limiting and
 * persist the feedback into a dedicated feedback table.
 */
router.post("/feedback", async (req, res) => {
  const businessId = cleanText(req.body?.businessId, 100);
  const rating = Number(req.body?.rating);
  const message = cleanText(req.body?.message, 2000);

  if (!businessId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "businessId and rating (1-5) are required" });
  }

  // Integration hook: persist to Feedback/CustomerInteraction in the database.
  return res.status(201).json({
    ok: true,
    feedback: {
      businessId,
      rating,
      message,
      status: "received"
    }
  });
});

/**
 * Public offer click tracking. Keep payload minimal; don't expose customer PII.
 */
router.post("/offer-click", async (req, res) => {
  const businessId = cleanText(req.body?.businessId, 100);
  const offerId = cleanText(req.body?.offerId, 100);
  if (!businessId || !offerId) {
    return res.status(400).json({ error: "businessId and offerId are required" });
  }
  return res.status(202).json({ ok: true, businessId, offerId });
});

export default router;
