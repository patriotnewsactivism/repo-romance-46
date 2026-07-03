export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      github_connections: {
        Row: {
          user_id: string;
          github_login: string;
          github_user_id: number | null;
          access_token: string;
          token_type: string | null;
          scope: string | null;
          connected_at: string;
        };
        Insert: {
          user_id: string;
          github_login: string;
          github_user_id?: number | null;
          access_token: string;
          token_type?: string;
          scope?: string | null;
          connected_at?: string;
        };
        Update: {
          user_id?: string;
          github_login?: string;
          github_user_id?: number | null;
          access_token?: string;
          token_type?: string;
          scope?: string | null;
          connected_at?: string;
        };
      };

      user_preferences: {
        Row: {
          user_id: string;
          custom_ai_provider: string;
          custom_ai_key: string | null;
          schedule_enabled: boolean;
          schedule_frequency: string;
          last_scheduled_run: string | null;
          email_notifications: boolean;
          filter_languages: string[];
          filter_exclude_archived: boolean;
          filter_min_stars: number;
          filter_max_repos: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          custom_ai_provider?: string;
          custom_ai_key?: string | null;
          schedule_enabled?: boolean;
          schedule_frequency?: string;
          last_scheduled_run?: string | null;
          email_notifications?: boolean;
          filter_languages?: string[];
          filter_exclude_archived?: boolean;
          filter_min_stars?: number;
          filter_max_repos?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          custom_ai_provider?: string;
          custom_ai_key?: string | null;
          schedule_enabled?: boolean;
          schedule_frequency?: string;
          last_scheduled_run?: string | null;
          email_notifications?: boolean;
          filter_languages?: string[];
          filter_exclude_archived?: boolean;
          filter_min_stars?: number;
          filter_max_repos?: number;
          created_at?: string;
          updated_at?: string;
        };
      };

      analyses: {
        Row: {
          id: string;
          user_id: string;
          status: string;
          error: string | null;
          repo_count: number;
          analyzed_repo_names: string[];
          summary_md: string | null;
          portfolio_stats: Json;
          ai_provider: string | null;
          ai_model: string | null;
          token_usage: Json | null;
          is_public: boolean;
          share_slug: string | null;
          share_expires_at: string | null;
          trigger_type: string;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: string;
          error?: string | null;
          repo_count?: number;
          analyzed_repo_names?: string[];
          summary_md?: string | null;
          portfolio_stats?: Json;
          ai_provider?: string | null;
          ai_model?: string | null;
          token_usage?: Json | null;
          is_public?: boolean;
          share_slug?: string | null;
          share_expires_at?: string | null;
          trigger_type?: string;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          status?: string;
          error?: string | null;
          repo_count?: number;
          analyzed_repo_names?: string[];
          summary_md?: string | null;
          portfolio_stats?: Json;
          ai_provider?: string | null;
          ai_model?: string | null;
          token_usage?: Json | null;
          is_public?: boolean;
          share_slug?: string | null;
          share_expires_at?: string | null;
          trigger_type?: string;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
      };

      analysis_items: {
        Row: {
          id: string;
          analysis_id: string;
          user_id: string;
          kind: string;
          title: string;
          repos: Json;
          pitch: string;
          next_steps: Json;
          effort: number;
          market_potential: number;
          rank: number;
          tech_stack: Json;
          marketing_tweet: string | null;
          marketing_linkedin: string | null;
          estimated_hours: number | null;
          is_starred: boolean;
          starred_at: string | null;
          user_notes: string | null;
          status: string | null;
          status_updated_at: string | null;
          finish_result: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          analysis_id: string;
          user_id: string;
          kind: string;
          title: string;
          repos?: Json;
          pitch: string;
          next_steps?: Json;
          effort?: number;
          market_potential?: number;
          rank?: number;
          tech_stack?: Json;
          marketing_tweet?: string | null;
          marketing_linkedin?: string | null;
          estimated_hours?: number | null;
          is_starred?: boolean;
          starred_at?: string | null;
          user_notes?: string | null;
          status?: string;
          status_updated_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          analysis_id?: string;
          user_id?: string;
          kind?: string;
          title?: string;
          repos?: Json;
          pitch?: string;
          next_steps?: Json;
          effort?: number;
          market_potential?: number;
          rank?: number;
          tech_stack?: Json;
          marketing_tweet?: string | null;
          marketing_linkedin?: string | null;
          estimated_hours?: number | null;
          is_starred?: boolean;
          starred_at?: string | null;
          user_notes?: string | null;
          status?: string;
          status_updated_at?: string | null;
          finish_result?: Json | null;
          created_at?: string;
        };
      };

      notification_log: {
        Row: {
          id: string;
          user_id: string;
          analysis_id: string | null;
          type: string;
          recipient: string | null;
          subject: string | null;
          status: string;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          analysis_id?: string | null;
          type: string;
          recipient?: string | null;
          subject?: string | null;
          status?: string;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          analysis_id?: string | null;
          type?: string;
          recipient?: string | null;
          subject?: string | null;
          status?: string;
          error?: string | null;
          created_at?: string;
        };
      };

      repo_cache: {
        Row: {
          id: string;
          user_id: string;
          github_repo_id: number;
          full_name: string;
          repo_data: Json;
          readme_text: string | null;
          file_tree: Json | null;
          fetched_at: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          github_repo_id: number;
          full_name: string;
          repo_data: Json;
          readme_text?: string | null;
          file_tree?: Json | null;
          fetched_at?: string;
          expires_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          github_repo_id?: number;
          full_name?: string;
          repo_data?: Json;
          readme_text?: string | null;
          file_tree?: Json | null;
          fetched_at?: string;
          expires_at?: string;
          created_at?: string;
        };
      };
    };
  };
};

type DatabasePublic = {
  Tables: Database["public"]["Tables"];
  Views: Record<string, never>;
  Functions: Record<string, never>;
  Enums: Record<string, never>;
  CompositeTypes: Record<string, never>;
};

export type { DatabasePublic };
