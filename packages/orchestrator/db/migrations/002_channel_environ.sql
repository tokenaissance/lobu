-- migrate:up
-- Add channel_environ table for channel-specific environment variables

-- Create channel_environ table
CREATE TABLE channel_environ (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(50) NOT NULL,
    channel_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    type VARCHAR(10) NOT NULL DEFAULT 'channel' CHECK (type IN ('channel', 'system')),
    set_by_user_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(platform, channel_id, name)
);

-- Create indexes for performance
CREATE INDEX idx_channel_environ_channel ON channel_environ(platform, channel_id);
CREATE INDEX idx_channel_environ_name ON channel_environ(name);
CREATE INDEX idx_channel_environ_type ON channel_environ(type);

-- Enable Row Level Security
ALTER TABLE channel_environ ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for channel environ
-- Note: This is a simplified policy, adjust based on your access control needs
CREATE POLICY channel_environ_policy ON channel_environ
FOR ALL USING (true)
WITH CHECK (true);

-- Create helper function to get channel environment variables
CREATE FUNCTION get_channel_environ(p_platform VARCHAR(50), p_channel_id VARCHAR(100))
RETURNS TABLE(name VARCHAR(255), value TEXT, type VARCHAR(10)) AS $$
BEGIN
    RETURN QUERY
    SELECT ce.name, ce.value, ce.type
    FROM channel_environ ce
    WHERE ce.platform = p_platform AND ce.channel_id = p_channel_id
    ORDER BY ce.type DESC, ce.name; -- System vars first, then channel vars
END;
$$ LANGUAGE plpgsql;

-- Create helper function to set channel environment variable
CREATE FUNCTION set_channel_environ(
    p_platform VARCHAR(50),
    p_channel_id VARCHAR(100),
    p_name VARCHAR(255),
    p_value TEXT,
    p_type VARCHAR(10) DEFAULT 'channel'
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO channel_environ (platform, channel_id, name, value, type, updated_at)
    VALUES (p_platform, p_channel_id, p_name, p_value, p_type, NOW())
    ON CONFLICT (platform, channel_id, name)
    DO UPDATE SET 
        value = EXCLUDED.value,
        type = EXCLUDED.type,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- migrate:down
DROP FUNCTION IF EXISTS set_channel_environ;
DROP FUNCTION IF EXISTS get_channel_environ;
DROP POLICY IF EXISTS channel_environ_policy ON channel_environ;
DROP TABLE IF EXISTS channel_environ;