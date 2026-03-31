-- Migration: Add email column to instance_members
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)

ALTER TABLE instance_members
  ADD COLUMN IF NOT EXISTS email TEXT;
