/**
 * Customer journey and public QR feedback endpoints.
 * Feedback is persisted as a Review so it appears in the business review inbox.
 */
import express from "express";
import { PrismaClient } from "@prisma/client";
const router = express.Router();
const prisma = new PrismaClient();

function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "customer-journey", version: "2.0" });
});

router.post("/feedback", async (req, res) => {
  try {
    const businessId = cleanText(req.body?.businessId, 100);
    const rating = Number(req.body?.rating);
    const message = cleanText(req.body?.message, 2000);
    const authorName = cleanText(req.body?.authorName, 80) || "QR Customer";

    if (!businessId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Business and a 1-5 star rating are required" });
    }

    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
    if (!business) return res.status(404).json({ error: "Business not found" });

    const review = await prisma.review.create({
      data: {
        businessId,
        authorName,
        rating,
        text: message || null,
        source: "QR_CUSTOMER",
        replyStatus: "DRAFT"
      }
    });

    return res.status(201).json({ ok: true, received: true, reviewId: review.id });
  } catch (error) {
    console.error("Customer feedback error:", error);
    return res.status(500).json({ error: "Unable to save feedback right now" });
  }
});

router.post("/offer-click", async (req, res) => {
  const businessId = cleanText(req.body?.businessId, 100);
  const offerId = cleanText(req.body?.offerId, 100);
  if (!businessId || !offerId) return res.status(400).json({ error: "businessId and offerId are required" });
  return res.status(202).json({ ok: true, businessId, offerId });
});

export default router;
