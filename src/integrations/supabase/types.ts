export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      analyses: {
        Row: {
          analyzed_repo_names: string[]
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          is_public: boolean
          portfolio_stats: Json
          repo_count: number
          share_slug: string | null
          status: string
          summary_md: string | null
          user_id: string
        }
        Insert: {
          analyzed_repo_names?: string[]
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          is_public?: boolean
          portfolio_stats?: Json
          repo_count?: number
          share_slug?: string | null
          status?: string
          summary_md?: string | null
          user_id: string
        }
        Update: {
          analyzed_repo_names?: string[]
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          is_public?: boolean
          portfolio_stats?: Json
          repo_count?: number
          share_slug?: string | null
          status?: string
          summary_md?: string | null
          user_id?: string
        }
        Relationships: []
      }
      analysis_items: {
        Row: {
          analysis_id: string
          created_at: string
          effort: number
          estimated_hours: number | null
          id: string
          is_starred: boolean
          kind: string
          market_potential: number
          marketing_linkedin: string | null
          marketing_tweet: string | null
          next_steps: Json
          pitch: string
          rank: number
          repos: Json
          starred_at: string | null
          tech_stack: string[]
          title: string
          user_id: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          effort?: number
          estimated_hours?: number | null
          id?: string
          is_starred?: boolean
          kind: string
          market_potential?: number
          marketing_linkedin?: string | null
          marketing_tweet?: string | null
          next_steps?: Json
          pitch: string
          rank?: number
          repos?: Json
          starred_at?: string | null
          tech_stack?: string[]
          title: string
          user_id: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          effort?: number
          estimated_hours?: number | null
          id?: string
          is_starred?: boolean
          kind?: string
          market_potential?: number
          marketing_linkedin?: string | null
          marketing_tweet?: string | null
          next_steps?: Json
          pitch?: string
          rank?: number
          repos?: Json
          starred_at?: string | null
          tech_stack?: string[]
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_items_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      github_connections: {
        Row: {
          access_token: string
          connected_at: string
          github_login: string
          scope: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          connected_at?: string
          github_login: string
          scope?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          connected_at?: string
          github_login?: string
          scope?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          analysis_id: string | null
          created_at: string
          id: string
          recipient: string
          status: string
          subject: string | null
          type: string
          user_id: string
        }
        Insert: {
          analysis_id?: string | null
          created_at?: string
          id?: string
          recipient: string
          status?: string
          subject?: string | null
          type: string
          user_id: string
        }
        Update: {
          analysis_id?: string | null
          created_at?: string
          id?: string
          recipient?: string
          status?: string
          subject?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      repo_cache: {
        Row: {
          expires_at: string
          fetched_at: string
          file_tree: string[] | null
          full_name: string
          github_repo_id: number
          id: string
          readme_text: string | null
          repo_data: Json
          user_id: string
        }
        Insert: {
          expires_at?: string
          fetched_at?: string
          file_tree?: string[] | null
          full_name: string
          github_repo_id: number
          id?: string
          readme_text?: string | null
          repo_data?: Json
          user_id: string
        }
        Update: {
          expires_at?: string
          fetched_at?: string
          file_tree?: string[] | null
          full_name?: string
          github_repo_id?: number
          id?: string
          readme_text?: string | null
          repo_data?: Json
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          custom_ai_key: string | null
          custom_ai_provider: string
          email_notifications: boolean
          filter_exclude_archived: boolean
          filter_languages: string[]
          filter_max_repos: number
          filter_min_stars: number
          last_scheduled_run: string | null
          schedule_enabled: boolean
          schedule_frequency: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_ai_key?: string | null
          custom_ai_provider?: string
          email_notifications?: boolean
          filter_exclude_archived?: boolean
          filter_languages?: string[]
          filter_max_repos?: number
          filter_min_stars?: number
          last_scheduled_run?: string | null
          schedule_enabled?: boolean
          schedule_frequency?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_ai_key?: string | null
          custom_ai_provider?: string
          email_notifications?: boolean
          filter_exclude_archived?: boolean
          filter_languages?: string[]
          filter_max_repos?: number
          filter_min_stars?: number
          last_scheduled_run?: string | null
          schedule_enabled?: boolean
          schedule_frequency?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
