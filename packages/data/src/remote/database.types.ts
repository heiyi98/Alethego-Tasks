/**
 * Supabase 数据库类型，结构与 `supabase gen types typescript` 的输出一致。
 * 目前按 supabase/migrations 手写；接入真实项目后可直接用生成结果替换本文件。
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OccurrenceStatusEnum = 'pending' | 'completed' | 'missed';

export interface Database {
  public: {
    Tables: {
      tasks: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          description: string;
          deadline_at: string | null;
          importance_level: number;
          recurrence_rule: string | null;
          recurrence_dtstart: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string;
          title: string;
          description?: string;
          deadline_at?: string | null;
          importance_level?: number;
          recurrence_rule?: string | null;
          recurrence_dtstart?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          description?: string;
          deadline_at?: string | null;
          importance_level?: number;
          recurrence_rule?: string | null;
          recurrence_dtstart?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          color: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string;
          name: string;
          color: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          color?: string;
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
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      occurrence_status: OccurrenceStatusEnum;
    };
    CompositeTypes: { [_ in never]: never };
  };
}

type PublicTables = Database['public']['Tables'];
export type TableRow<T extends keyof PublicTables> = PublicTables[T]['Row'];
export type TableInsert<T extends keyof PublicTables> = PublicTables[T]['Insert'];
export type TableUpdate<T extends keyof PublicTables> = PublicTables[T]['Update'];
