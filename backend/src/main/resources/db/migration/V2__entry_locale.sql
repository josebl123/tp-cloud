-- The language a customer joined in, so every notification we send them later matches the page
-- they were reading when they took their place in the line.
ALTER TABLE queue_entry ADD COLUMN locale VARCHAR(8) NOT NULL DEFAULT 'EN';
ALTER TABLE queue_entry ADD CONSTRAINT ck_entry_locale CHECK (locale IN ('EN', 'ES'));
