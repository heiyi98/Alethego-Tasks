/**
 * Supabase 数据库类型，结构与 `supabase gen types typescript --schema taskapp` 的输出一致。
 * 目前按 supabase/migrations 手写；接入真实项目后可直接用生成结果替换本文件。
 */

/** 业务表所在的 schema（不使用 public） */
export const DB_SCHEMA = 'taskapp';

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OccurrenceStatusEnum = 'pending' | 'completed' | 'missed';

export type GroupKindEnum = 'cooperative' | 'management' | 'education';

export interface Database {
  taskapp: {
    Tables: {
      groups: {
        Row: {
          id: string;
          kind: GroupKindEnum;
          name: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      group_members: {
        Row: {
          group_id: string;
          user_id: string;
          role: 'leader' | 'member';
          nickname: string | null;
          joined_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { nickname?: string | null };
        Relationships: [];
      };
      group_invitations: {
        Row: {
          id: string;
          group_id: string;
          email: string;
          invited_by: string;
          created_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      group_deletion_requests: {
        Row: { group_id: string; initiated_by: string; started_at: string };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      group_deletion_votes: {
        Row: { group_id: string; user_id: string; voted_at: string };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          email: string | null;
          display_name: string;
          notifications_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email?: string | null;
          display_name: string;
          notifications_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          display_name?: string;
          notifications_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          owner_id: string;
          group_id: string | null;
          title: string;
          description: string;
          deadline_at: string | null;
          importance_level: number;
          recurrence_rule: string | null;
          recurrence_dtstart: string | null;
          completed_at: string | null;
          is_starred: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id?: string;
          group_id?: string | null;
          title: string;
          description?: string;
          deadline_at?: string | null;
          importance_level?: number;
          recurrence_rule?: string | null;
          recurrence_dtstart?: string | null;
          completed_at?: string | null;
          is_starred?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          owner_id?: string;
          group_id?: string | null;
          title?: string;
          description?: string;
          deadline_at?: string | null;
          importance_level?: number;
          recurrence_rule?: string | null;
          recurrence_dtstart?: string | null;
          completed_at?: string | null;
          is_starred?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          color: string;
          description: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string;
          name: string;
          color: string;
          description?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          color?: string;
          description?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      task_categories: {
        Row: {
          task_id: string;
          category_id: string;
          created_at: string;
        };
        Insert: {
          task_id: string;
          category_id: string;
          created_at?: string;
        };
        Update: {
          task_id?: string;
          category_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'task_categories_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_categories_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      recurrence_occurrences: {
        Row: {
          id: string;
          task_id: string;
          occurrence_date: string;
          status: OccurrenceStatusEnum;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          occurrence_date: string;
          status?: OccurrenceStatusEnum;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          occurrence_date?: string;
          status?: OccurrenceStatusEnum;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recurrence_occurrences_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      task_locations: {
        Row: {
          task_id: string;
          name: string;
          address: string;
          place_id: string | null;
          lat: number | null;
          lng: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          task_id: string;
          name?: string;
          address?: string;
          place_id?: string | null;
          lat?: number | null;
          lng?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          task_id?: string;
          name?: string;
          address?: string;
          place_id?: string | null;
          lat?: number | null;
          lng?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'task_locations_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: true;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      task_people: {
        Row: {
          id: string;
          task_id: string;
          name: string;
          relation: string;
          contact_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          name: string;
          relation?: string;
          contact_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          name?: string;
          relation?: string;
          contact_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'task_people_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_group: {
        Args: { p_name: string };
        Returns: Database['taskapp']['Tables']['groups']['Row'];
      };
      group_roster: {
        Args: { p_group_id: string };
        Returns: {
          user_id: string;
          nickname: string;
          has_custom_nickname: boolean;
          is_me: boolean;
          joined_at: string;
        }[];
      };
      invite_to_group: {
        Args: { p_group_id: string; p_email: string };
        Returns: 'invited' | 'already_invited' | 'already_member' | 'self';
      };
      accept_group_invitation: { Args: { p_invitation_id: string }; Returns: string };
      decline_group_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      request_group_deletion: {
        Args: { p_group_id: string };
        Returns: 'deleted' | 'requested' | 'already_requested';
      };
      vote_group_deletion: {
        Args: { p_group_id: string; p_agree: boolean };
        Returns: 'deleted' | 'agreed' | 'cancelled' | 'no_request';
      };
      process_expired_group_deletions: { Args: Record<string, never>; Returns: number };
      my_notifications: {
        Args: Record<string, never>;
        Returns: {
          kind: 'group_invitation' | 'group_deletion_vote';
          id: string;
          group_id: string;
          group_name: string;
          actor_name: string;
          created_at: string;
        }[];
      };
      mark_notifications_seen: { Args: Record<string, never>; Returns: string };
      ensure_current_user: {
        Args: { p_email: string | null; p_display_name: string };
        Returns: Database['taskapp']['Tables']['users']['Row'];
      };
    };
    Enums: {
      occurrence_status: OccurrenceStatusEnum;
    };
    CompositeTypes: { [_ in never]: never };
  };
}

type AppTables = Database[typeof DB_SCHEMA]['Tables'];
export type TableRow<T extends keyof AppTables> = AppTables[T]['Row'];
export type TableInsert<T extends keyof AppTables> = AppTables[T]['Insert'];
export type TableUpdate<T extends keyof AppTables> = AppTables[T]['Update'];
