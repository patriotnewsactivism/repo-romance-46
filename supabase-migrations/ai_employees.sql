-- AI Employees tables for RepoFinisher
-- Run this in the Supabase SQL Editor (Dashboard > SQL > New Query)

-- AI Employees table
CREATE TABLE IF NOT EXISTS ai_employees (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'support',
  status text NOT NULL DEFAULT 'active',
  avatar text,
  description text,
  instructions text,
  last_active timestamptz,
  tasks_completed int DEFAULT 0,
  tasks_today int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Employee logs table (task history)
CREATE TABLE IF NOT EXISTS employee_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id text,
  employee_name text,
  role text,
  task_type text,
  status text DEFAULT 'pending',
  input text,
  output text,
  summary text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Enable Row Level Security
ALTER TABLE ai_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users can see all employees and their own logs
CREATE POLICY "Users can view all AI employees" ON ai_employees
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view employee logs" ON employee_logs
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Service role bypasses RLS, so the cron runner can insert/update freely

-- Insert default AI employees
INSERT INTO ai_employees (name, role, status, description, instructions) VALUES
  ('Sam', 'support', 'active', 'Customer support agent — monitors inbox, responds to customer emails', 'You are Sam, the customer support agent for RepoFinisher. Be friendly, helpful, and concise.'),
  ('Eli', 'engineering', 'active', 'Engineering agent — watches GitHub issues, triages bugs, suggests fixes', 'You are Eli, the engineering agent for RepoFinisher. You triage issues and suggest fixes.'),
  ('Maya', 'marketing', 'active', 'Marketing agent — creates social media content', 'You are Maya, the marketing agent for RepoFinisher. You create engaging, authentic content.'),
  ('Oscar', 'ops', 'active', 'Ops agent — monitors deployments, error logs, uptime', 'You are Oscar, the ops agent. You monitor system health and alert on issues.'),
  ('Piper', 'product', 'active', 'Product agent — analyzes feedback, suggests features', 'You are Piper, the product agent. You analyze feedback and suggest improvements.')
ON CONFLICT DO NOTHING;
