-- Migration: Add progress column to analyses table
ALTER TABLE analyses 
ADD COLUMN IF NOT EXISTS progress text DEFAULT NULL;
COMMENT ON COLUMN analyses.progress IS 'Human-readable progress message during running state';
