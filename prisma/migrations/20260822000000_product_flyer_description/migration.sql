-- F-1 - a product flyer carries its own copy.
--
-- A flyer is a promotion, and the artwork alone cannot carry the offer's
-- terms, dates or small print as text a distributor can read, copy or have
-- read aloud. Baking that into the image makes it unsearchable and unusable
-- at small sizes.
--
-- Nullable with no default: flyers created before this migration read back
-- NULL rather than an empty string, so "never written" stays distinguishable
-- from "deliberately cleared".

ALTER TABLE "ProductFlyer" ADD COLUMN "description" TEXT;
