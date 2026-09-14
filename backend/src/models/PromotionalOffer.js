import mongoose from 'mongoose';

const promotionalOfferSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  discountPercentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  validUntil: {
    type: Date,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  }
}, { timestamps: true });

const PromotionalOffer = mongoose.models.PromotionalOffer || mongoose.model('PromotionalOffer', promotionalOfferSchema);
export default PromotionalOffer;
