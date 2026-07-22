-- Phase 3: the AI extracts the founder's name from the deck on upload; store it
-- on the deck so the Review-decks table can show it without joining extractions.
ALTER TABLE decks ADD COLUMN founder TEXT;
