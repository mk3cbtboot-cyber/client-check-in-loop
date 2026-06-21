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
      appointments: {
        Row: {
          attended_at: string | null
          client_id: string
          created_at: string
          id: string
          missed_flagged_at: string | null
          notes: string | null
          practitioner_id: string
          scheduled_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          attended_at?: string | null
          client_id: string
          created_at?: string
          id?: string
          missed_flagged_at?: string | null
          notes?: string | null
          practitioner_id: string
          scheduled_at: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          attended_at?: string | null
          client_id?: string
          created_at?: string
          id?: string
          missed_flagged_at?: string | null
          notes?: string | null
          practitioner_id?: string
          scheduled_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          acid_reflux: number | null
          allergy_skin: number | null
          body_fat_pct: number | null
          chest_cm: number | null
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
          chest_cm?: number | null
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
          chest_cm?: number | null
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
          archived_at: string | null
          batch_cooking_mode: string
          breakfast_protein_category: string | null
          breakfast_protein_grams: number | null
          breakfast_veg_grams: number | null
          client_goal: string
          client_last_read_at: string | null
          client_type: string
          created_at: string
          current_medications: string
          dinner_protein_category: string | null
          dinner_protein_grams: number | null
          dinner_veg_grams: number | null
          eggs_min_per_week: number | null
          email: string
          food_bread: string
          food_cheese: string
          food_fish: string
          food_fruit: string
          food_legumes: string
          food_limit_counts: Json
          food_limits: Json
          food_list: Json
          food_list_notes: Json
          food_meat: string
          food_milk_products: string
          food_nuts: string
          food_poultry: string
          food_pumpkin_seeds: string
          food_seafood: string
          food_starch: string
          food_sunflower_seeds: string
          food_veg_lettuce: string
          food_vegetables: string
          food_yogurt: string
          gender: string | null
          height_cm: number | null
          id: string
          length_unit: string
          lunch_protein_category: string | null
          lunch_protein_grams: number | null
          lunch_veg_grams: number | null
          magic_token: string
          mb_meal_options: Json
          mb_pdf_path: string | null
          meal_streak: number
          medical_conditions: string
          name: string
          phase: string
          phase2_food_list: Json | null
          phase2_strict_mode: string
          phase2_strict_started_at: string | null
          phase3_additional_foods: string
          phase3_bread: string
          phase3_dairy: string
          phase3_fish: string
          phase3_fruit: string
          phase3_lunch_carb_bonus: number
          phase3_lunch_prompt_last_dismissed_on: string | null
          phase3_lunch_protein_bonus: number
          phase3_mb_cheese: string
          phase3_mb_fat_oil: string
          phase3_mb_fish: string
          phase3_mb_legumes: string
          phase3_mb_meat: string
          phase3_mb_seafood: string
          phase3_mb_sprouts: string
          phase3_mb_veg_lettuce: string
          phase3_mb_vegetables: string
          phase3_meat: string
          phase3_mode: string
          phase3_other: string
          phase3_portions_confirmed: boolean
          phase3_starches: string
          phase3_vegetables: string
          phase4_start_date: string | null
          plan_format: string
          practitioner_id: string
          practitioner_last_read_at: string | null
          practitioner_notes: string
          show_8_rules: boolean
          show_rules: boolean
          system_mode: string
          vitamins_supplements: string
          water_date: string
          water_target_litres: number
          water_today_litres: number
          week_reset_date: string
          weight_unit: string
          welcome_seen: boolean
        }
        Insert: {
          archived_at?: string | null
          batch_cooking_mode?: string
          breakfast_protein_category?: string | null
          breakfast_protein_grams?: number | null
          breakfast_veg_grams?: number | null
          client_goal?: string
          client_last_read_at?: string | null
          client_type?: string
          created_at?: string
          current_medications?: string
          dinner_protein_category?: string | null
          dinner_protein_grams?: number | null
          dinner_veg_grams?: number | null
          eggs_min_per_week?: number | null
          email: string
          food_bread?: string
          food_cheese?: string
          food_fish?: string
          food_fruit?: string
          food_legumes?: string
          food_limit_counts?: Json
          food_limits?: Json
          food_list?: Json
          food_list_notes?: Json
          food_meat?: string
          food_milk_products?: string
          food_nuts?: string
          food_poultry?: string
          food_pumpkin_seeds?: string
          food_seafood?: string
          food_starch?: string
          food_sunflower_seeds?: string
          food_veg_lettuce?: string
          food_vegetables?: string
          food_yogurt?: string
          gender?: string | null
          height_cm?: number | null
          id?: string
          length_unit?: string
          lunch_protein_category?: string | null
          lunch_protein_grams?: number | null
          lunch_veg_grams?: number | null
          magic_token?: string
          mb_meal_options?: Json
          mb_pdf_path?: string | null
          meal_streak?: number
          medical_conditions?: string
          name: string
          phase?: string
          phase2_food_list?: Json | null
          phase2_strict_mode?: string
          phase2_strict_started_at?: string | null
          phase3_additional_foods?: string
          phase3_bread?: string
          phase3_dairy?: string
          phase3_fish?: string
          phase3_fruit?: string
          phase3_lunch_carb_bonus?: number
          phase3_lunch_prompt_last_dismissed_on?: string | null
          phase3_lunch_protein_bonus?: number
          phase3_mb_cheese?: string
          phase3_mb_fat_oil?: string
          phase3_mb_fish?: string
          phase3_mb_legumes?: string
          phase3_mb_meat?: string
          phase3_mb_seafood?: string
          phase3_mb_sprouts?: string
          phase3_mb_veg_lettuce?: string
          phase3_mb_vegetables?: string
          phase3_meat?: string
          phase3_mode?: string
          phase3_other?: string
          phase3_portions_confirmed?: boolean
          phase3_starches?: string
          phase3_vegetables?: string
          phase4_start_date?: string | null
          plan_format?: string
          practitioner_id: string
          practitioner_last_read_at?: string | null
          practitioner_notes?: string
          show_8_rules?: boolean
          show_rules?: boolean
          system_mode?: string
          vitamins_supplements?: string
          water_date?: string
          water_target_litres?: number
          water_today_litres?: number
          week_reset_date?: string
          weight_unit?: string
          welcome_seen?: boolean
        }
        Update: {
          archived_at?: string | null
          batch_cooking_mode?: string
          breakfast_protein_category?: string | null
          breakfast_protein_grams?: number | null
          breakfast_veg_grams?: number | null
          client_goal?: string
          client_last_read_at?: string | null
          client_type?: string
          created_at?: string
          current_medications?: string
          dinner_protein_category?: string | null
          dinner_protein_grams?: number | null
          dinner_veg_grams?: number | null
          eggs_min_per_week?: number | null
          email?: string
          food_bread?: string
          food_cheese?: string
          food_fish?: string
          food_fruit?: string
          food_legumes?: string
          food_limit_counts?: Json
          food_limits?: Json
          food_list?: Json
          food_list_notes?: Json
          food_meat?: string
          food_milk_products?: string
          food_nuts?: string
          food_poultry?: string
          food_pumpkin_seeds?: string
          food_seafood?: string
          food_starch?: string
          food_sunflower_seeds?: string
          food_veg_lettuce?: string
          food_vegetables?: string
          food_yogurt?: string
          gender?: string | null
          height_cm?: number | null
          id?: string
          length_unit?: string
          lunch_protein_category?: string | null
          lunch_protein_grams?: number | null
          lunch_veg_grams?: number | null
          magic_token?: string
          mb_meal_options?: Json
          mb_pdf_path?: string | null
          meal_streak?: number
          medical_conditions?: string
          name?: string
          phase?: string
          phase2_food_list?: Json | null
          phase2_strict_mode?: string
          phase2_strict_started_at?: string | null
          phase3_additional_foods?: string
          phase3_bread?: string
          phase3_dairy?: string
          phase3_fish?: string
          phase3_fruit?: string
          phase3_lunch_carb_bonus?: number
          phase3_lunch_prompt_last_dismissed_on?: string | null
          phase3_lunch_protein_bonus?: number
          phase3_mb_cheese?: string
          phase3_mb_fat_oil?: string
          phase3_mb_fish?: string
          phase3_mb_legumes?: string
          phase3_mb_meat?: string
          phase3_mb_seafood?: string
          phase3_mb_sprouts?: string
          phase3_mb_veg_lettuce?: string
          phase3_mb_vegetables?: string
          phase3_meat?: string
          phase3_mode?: string
          phase3_other?: string
          phase3_portions_confirmed?: boolean
          phase3_starches?: string
          phase3_vegetables?: string
          phase4_start_date?: string | null
          plan_format?: string
          practitioner_id?: string
          practitioner_last_read_at?: string | null
          practitioner_notes?: string
          show_8_rules?: boolean
          show_rules?: boolean
          system_mode?: string
          vitamins_supplements?: string
          water_date?: string
          water_target_litres?: number
          water_today_litres?: number
          week_reset_date?: string
          weight_unit?: string
          welcome_seen?: boolean
        }
        Relationships: []
      }
      daily_water_logs: {
        Row: {
          client_id: string
          created_at: string
          id: string
          litres: number
          log_date: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          litres?: number
          log_date: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          litres?: number
          log_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_water_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          client_id: string
          created_at: string
          deferred: boolean
          id: string
          sender: string
        }
        Insert: {
          body: string
          client_id: string
          created_at?: string
          deferred?: boolean
          id?: string
          sender: string
        }
        Update: {
          body?: string
          client_id?: string
          created_at?: string
          deferred?: boolean
          id?: string
          sender?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          office_hours: Json
          ooo_message: string
          ooo_return_date: string | null
          out_of_office: boolean
          practitioner_tier: string | null
          timezone: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          office_hours?: Json
          ooo_message?: string
          ooo_return_date?: string | null
          out_of_office?: boolean
          practitioner_tier?: string | null
          timezone?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          office_hours?: Json
          ooo_message?: string
          ooo_return_date?: string | null
          out_of_office?: boolean
          practitioner_tier?: string | null
          timezone?: string | null
        }
        Relationships: []
      }
      recipes: {
        Row: {
          client_id: string
          created_at: string
          egg_count: number
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
          egg_count?: number
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
          egg_count?: number
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
          breakfast_batch_start_date: string | null
          breakfast_batch_start_date_alt: string | null
          breakfast_locked_recipe: Json | null
          breakfast_locked_recipe_alt: Json | null
          breakfast_meal_id: number | null
          breakfast_meal_id_alt: number | null
          breakfast_primary_days: number
          breakfast_primary_log_count: number
          breakfast_selections: Json
          breakfast_selections_alt: Json
          client_id: string
          confirmed_at: string | null
          created_at: string
          dinner_batch_start_date: string | null
          dinner_batch_start_date_alt: string | null
          dinner_locked_recipe: Json | null
          dinner_locked_recipe_alt: Json | null
          dinner_meal_id: number | null
          dinner_meal_id_alt: number | null
          dinner_primary_days: number
          dinner_primary_log_count: number
          dinner_selections: Json
          dinner_selections_alt: Json
          id: string
          lunch_batch_start_date: string | null
          lunch_batch_start_date_alt: string | null
          lunch_locked_recipe: Json | null
          lunch_locked_recipe_alt: Json | null
          lunch_meal_id: number | null
          lunch_meal_id_alt: number | null
          lunch_primary_days: number
          lunch_primary_log_count: number
          lunch_selections: Json
          lunch_selections_alt: Json
          updated_at: string
          week_start_date: string
        }
        Insert: {
          breakfast_batch_start_date?: string | null
          breakfast_batch_start_date_alt?: string | null
          breakfast_locked_recipe?: Json | null
          breakfast_locked_recipe_alt?: Json | null
          breakfast_meal_id?: number | null
          breakfast_meal_id_alt?: number | null
          breakfast_primary_days?: number
          breakfast_primary_log_count?: number
          breakfast_selections?: Json
          breakfast_selections_alt?: Json
          client_id: string
          confirmed_at?: string | null
          created_at?: string
          dinner_batch_start_date?: string | null
          dinner_batch_start_date_alt?: string | null
          dinner_locked_recipe?: Json | null
          dinner_locked_recipe_alt?: Json | null
          dinner_meal_id?: number | null
          dinner_meal_id_alt?: number | null
          dinner_primary_days?: number
          dinner_primary_log_count?: number
          dinner_selections?: Json
          dinner_selections_alt?: Json
          id?: string
          lunch_batch_start_date?: string | null
          lunch_batch_start_date_alt?: string | null
          lunch_locked_recipe?: Json | null
          lunch_locked_recipe_alt?: Json | null
          lunch_meal_id?: number | null
          lunch_meal_id_alt?: number | null
          lunch_primary_days?: number
          lunch_primary_log_count?: number
          lunch_selections?: Json
          lunch_selections_alt?: Json
          updated_at?: string
          week_start_date: string
        }
        Update: {
          breakfast_batch_start_date?: string | null
          breakfast_batch_start_date_alt?: string | null
          breakfast_locked_recipe?: Json | null
          breakfast_locked_recipe_alt?: Json | null
          breakfast_meal_id?: number | null
          breakfast_meal_id_alt?: number | null
          breakfast_primary_days?: number
          breakfast_primary_log_count?: number
          breakfast_selections?: Json
          breakfast_selections_alt?: Json
          client_id?: string
          confirmed_at?: string | null
          created_at?: string
          dinner_batch_start_date?: string | null
          dinner_batch_start_date_alt?: string | null
          dinner_locked_recipe?: Json | null
          dinner_locked_recipe_alt?: Json | null
          dinner_meal_id?: number | null
          dinner_meal_id_alt?: number | null
          dinner_primary_days?: number
          dinner_primary_log_count?: number
          dinner_selections?: Json
          dinner_selections_alt?: Json
          id?: string
          lunch_batch_start_date?: string | null
          lunch_batch_start_date_alt?: string | null
          lunch_locked_recipe?: Json | null
          lunch_locked_recipe_alt?: Json | null
          lunch_meal_id?: number | null
          lunch_meal_id_alt?: number | null
          lunch_primary_days?: number
          lunch_primary_log_count?: number
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
