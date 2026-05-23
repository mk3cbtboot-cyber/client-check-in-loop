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
      check_ins: {
        Row: {
          acid_reflux: number | null
          allergy_skin: number | null
          body_fat_pct: number | null
          client_id: string
          created_at: string
          digestion: number | null
          fatigue: number | null
          feeling: number | null
          general_wellbeing: number | null
          headache: number | null
          hip_cm: number | null
          id: string
          is_weekly: boolean
          joint_pain: number | null
          notes: string | null
          pain: number | null
          sleep: number | null
          upper_thigh_cm: number | null
          waist_cm: number | null
          water_glasses: number | null
          water_litres: number | null
          weight_kg: number | null
        }
        Insert: {
          acid_reflux?: number | null
          allergy_skin?: number | null
          body_fat_pct?: number | null
          client_id: string
          created_at?: string
          digestion?: number | null
          fatigue?: number | null
          feeling?: number | null
          general_wellbeing?: number | null
          headache?: number | null
          hip_cm?: number | null
          id?: string
          is_weekly?: boolean
          joint_pain?: number | null
          notes?: string | null
          pain?: number | null
          sleep?: number | null
          upper_thigh_cm?: number | null
          waist_cm?: number | null
          water_glasses?: number | null
          water_litres?: number | null
          weight_kg?: number | null
        }
        Update: {
          acid_reflux?: number | null
          allergy_skin?: number | null
          body_fat_pct?: number | null
          client_id?: string
          created_at?: string
          digestion?: number | null
          fatigue?: number | null
          feeling?: number | null
          general_wellbeing?: number | null
          headache?: number | null
          hip_cm?: number | null
          id?: string
          is_weekly?: boolean
          joint_pain?: number | null
          notes?: string | null
          pain?: number | null
          sleep?: number | null
          upper_thigh_cm?: number | null
          waist_cm?: number | null
          water_glasses?: number | null
          water_litres?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          avocado_count_week: number
          client_goal: string
          created_at: string
          current_medications: string
          egg_count_week: number
          email: string
          height_cm: number | null
          id: string
          length_unit: string
          magic_token: string
          meal_streak: number
          medical_conditions: string
          name: string
          phase: string
          phase2_food_list: Json | null
          phase2_strict_extra_days: number
          phase2_strict_mode: string
          phase2_strict_started_at: string | null
          phase3_additional_foods: string
          phase3_bread: string
          phase3_dairy: string
          phase3_fish: string
          phase3_fruit: string
          phase3_mb_cheese: string
          phase3_mb_fat_oil: string
          phase3_mb_fish: string
          phase3_mb_legumes: string
          phase3_mb_seafood: string
          phase3_mb_vegetables: string
          phase3_meat: string
          phase3_mode: string
          phase3_other: string
          phase3_starches: string
          phase3_vegetables: string
          practitioner_id: string
          practitioner_notes: string
          show_rules: boolean
          system_mode: string
          vitamins_supplements: string
          water_date: string
          water_today_litres: number
          week_reset_date: string
          weekly_food_limits: Json
          weight_unit: string
        }
        Insert: {
          avocado_count_week?: number
          client_goal?: string
          created_at?: string
          current_medications?: string
          egg_count_week?: number
          email: string
          height_cm?: number | null
          id?: string
          length_unit?: string
          magic_token?: string
          meal_streak?: number
          medical_conditions?: string
          name: string
          phase?: string
          phase2_food_list?: Json | null
          phase2_strict_extra_days?: number
          phase2_strict_mode?: string
          phase2_strict_started_at?: string | null
          phase3_additional_foods?: string
          phase3_bread?: string
          phase3_dairy?: string
          phase3_fish?: string
          phase3_fruit?: string
          phase3_mb_cheese?: string
          phase3_mb_fat_oil?: string
          phase3_mb_fish?: string
          phase3_mb_legumes?: string
          phase3_mb_seafood?: string
          phase3_mb_vegetables?: string
          phase3_meat?: string
          phase3_mode?: string
          phase3_other?: string
          phase3_starches?: string
          phase3_vegetables?: string
          practitioner_id: string
          practitioner_notes?: string
          show_rules?: boolean
          system_mode?: string
          vitamins_supplements?: string
          water_date?: string
          water_today_litres?: number
          week_reset_date?: string
          weekly_food_limits?: Json
          weight_unit?: string
        }
        Update: {
          avocado_count_week?: number
          client_goal?: string
          created_at?: string
          current_medications?: string
          egg_count_week?: number
          email?: string
          height_cm?: number | null
          id?: string
          length_unit?: string
          magic_token?: string
          meal_streak?: number
          medical_conditions?: string
          name?: string
          phase?: string
          phase2_food_list?: Json | null
          phase2_strict_extra_days?: number
          phase2_strict_mode?: string
          phase2_strict_started_at?: string | null
          phase3_additional_foods?: string
          phase3_bread?: string
          phase3_dairy?: string
          phase3_fish?: string
          phase3_fruit?: string
          phase3_mb_cheese?: string
          phase3_mb_fat_oil?: string
          phase3_mb_fish?: string
          phase3_mb_legumes?: string
          phase3_mb_seafood?: string
          phase3_mb_vegetables?: string
          phase3_meat?: string
          phase3_mode?: string
          phase3_other?: string
          phase3_starches?: string
          phase3_vegetables?: string
          practitioner_id?: string
          practitioner_notes?: string
          show_rules?: boolean
          system_mode?: string
          vitamins_supplements?: string
          water_date?: string
          water_today_litres?: number
          week_reset_date?: string
          weekly_food_limits?: Json
          weight_unit?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      recipes: {
        Row: {
          client_id: string
          created_at: string
          id: string
          ingredients: Json
          instructions: Json
          meal_type: string | null
          name: string
          prep_time: string
          servings: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          ingredients?: Json
          instructions?: Json
          meal_type?: string | null
          name: string
          prep_time: string
          servings: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          ingredients?: Json
          instructions?: Json
          meal_type?: string | null
          name?: string
          prep_time?: string
          servings?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_limit_acknowledgements: {
        Row: {
          acknowledged_at: string
          client_id: string
          food_name: string
          id: string
          limit_value: number
          per_serving_qty: number
          week_start_date: string
        }
        Insert: {
          acknowledged_at?: string
          client_id: string
          food_name: string
          id?: string
          limit_value: number
          per_serving_qty: number
          week_start_date: string
        }
        Update: {
          acknowledged_at?: string
          client_id?: string
          food_name?: string
          id?: string
          limit_value?: number
          per_serving_qty?: number
          week_start_date?: string
        }
        Relationships: []
      }
      weekly_meal_plans: {
        Row: {
          breakfast_meal_id: number | null
          breakfast_meal_id_alt: number | null
          breakfast_primary_days: number
          breakfast_selections: Json
          breakfast_selections_alt: Json
          client_id: string
          confirmed_at: string | null
          created_at: string
          dinner_meal_id: number | null
          dinner_meal_id_alt: number | null
          dinner_primary_days: number
          dinner_selections: Json
          dinner_selections_alt: Json
          id: string
          lunch_meal_id: number | null
          lunch_meal_id_alt: number | null
          lunch_primary_days: number
          lunch_selections: Json
          lunch_selections_alt: Json
          updated_at: string
          week_start_date: string
        }
        Insert: {
          breakfast_meal_id?: number | null
          breakfast_meal_id_alt?: number | null
          breakfast_primary_days?: number
          breakfast_selections?: Json
          breakfast_selections_alt?: Json
          client_id: string
          confirmed_at?: string | null
          created_at?: string
          dinner_meal_id?: number | null
          dinner_meal_id_alt?: number | null
          dinner_primary_days?: number
          dinner_selections?: Json
          dinner_selections_alt?: Json
          id?: string
          lunch_meal_id?: number | null
          lunch_meal_id_alt?: number | null
          lunch_primary_days?: number
          lunch_selections?: Json
          lunch_selections_alt?: Json
          updated_at?: string
          week_start_date: string
        }
        Update: {
          breakfast_meal_id?: number | null
          breakfast_meal_id_alt?: number | null
          breakfast_primary_days?: number
          breakfast_selections?: Json
          breakfast_selections_alt?: Json
          client_id?: string
          confirmed_at?: string | null
          created_at?: string
          dinner_meal_id?: number | null
          dinner_meal_id_alt?: number | null
          dinner_primary_days?: number
          dinner_selections?: Json
          dinner_selections_alt?: Json
          id?: string
          lunch_meal_id?: number | null
          lunch_meal_id_alt?: number | null
          lunch_primary_days?: number
          lunch_selections?: Json
          lunch_selections_alt?: Json
          updated_at?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_meal_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "practitioner" | "client"
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
    Enums: {
      app_role: ["practitioner", "client"],
    },
  },
} as const
