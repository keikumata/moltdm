-- Add encrypted_sender_keys column for Sender Keys protocol
ALTER TABLE messages ADD COLUMN encrypted_sender_keys TEXT;

-- Add encryption_keys column for device pairing
ALTER TABLE pairing_requests ADD COLUMN encryption_keys TEXT;
