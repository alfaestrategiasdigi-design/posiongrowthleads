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
      api_tokens: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          tenant_id: string
          token: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          tenant_id: string
          token?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_type: string
          channel: string | null
          client_name: string
          client_phone: string
          created_at: string
          date_time: string
          duration_minutes: number
          id: string
          lead_id: string | null
          notes: string | null
          procedure: string | null
          reminder_hours_before: number
          reminder_sent: boolean
          reminder_sent_at: string | null
          responsible_user_id: string | null
          send_reminder: boolean
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          appointment_type?: string
          channel?: string | null
          client_name: string
          client_phone: string
          created_at?: string
          date_time: string
          duration_minutes?: number
          id?: string
          lead_id?: string | null
          notes?: string | null
          procedure?: string | null
          reminder_hours_before?: number
          reminder_sent?: boolean
          reminder_sent_at?: string | null
          responsible_user_id?: string | null
          send_reminder?: boolean
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          appointment_type?: string
          channel?: string | null
          client_name?: string
          client_phone?: string
          created_at?: string
          date_time?: string
          duration_minutes?: number
          id?: string
          lead_id?: string | null
          notes?: string | null
          procedure?: string | null
          reminder_hours_before?: number
          reminder_sent?: boolean
          reminder_sent_at?: string | null
          responsible_user_id?: string | null
          send_reminder?: boolean
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_insights: {
        Row: {
          ad_account_id: string
          ad_id: string | null
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          campaign_id: string | null
          campaign_name: string | null
          clicks: number | null
          cost_per_lead: number | null
          cpc: number | null
          cpm: number | null
          created_at: string
          ctr: number | null
          date_start: string
          frequency: number | null
          id: string
          impressions: number | null
          leads: number | null
          level: string
          link_clicks: number | null
          purchase_value: number | null
          purchases: number | null
          raw: Json | null
          reach: number | null
          roas: number | null
          spend: number | null
          tenant_id: string | null
          updated_at: string
          video_views: number | null
        }
        Insert: {
          ad_account_id: string
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          clicks?: number | null
          cost_per_lead?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          date_start: string
          frequency?: number | null
          id?: string
          impressions?: number | null
          leads?: number | null
          level: string
          link_clicks?: number | null
          purchase_value?: number | null
          purchases?: number | null
          raw?: Json | null
          reach?: number | null
          roas?: number | null
          spend?: number | null
          tenant_id?: string | null
          updated_at?: string
          video_views?: number | null
        }
        Update: {
          ad_account_id?: string
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          clicks?: number | null
          cost_per_lead?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          date_start?: string
          frequency?: number | null
          id?: string
          impressions?: number | null
          leads?: number | null
          level?: string
          link_clicks?: number | null
          purchase_value?: number | null
          purchases?: number | null
          raw?: Json | null
          reach?: number | null
          roas?: number | null
          spend?: number | null
          tenant_id?: string | null
          updated_at?: string
          video_views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_insights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_insights_breakdown: {
        Row: {
          breakdown_type: string
          breakdown_value: string
          clicks: number | null
          created_at: string
          id: string
          impressions: number | null
          insight_id: string
          leads: number | null
          purchase_value: number | null
          purchases: number | null
          raw: Json | null
          spend: number | null
        }
        Insert: {
          breakdown_type: string
          breakdown_value: string
          clicks?: number | null
          created_at?: string
          id?: string
          impressions?: number | null
          insight_id: string
          leads?: number | null
          purchase_value?: number | null
          purchases?: number | null
          raw?: Json | null
          spend?: number | null
        }
        Update: {
          breakdown_type?: string
          breakdown_value?: string
          clicks?: number | null
          created_at?: string
          id?: string
          impressions?: number | null
          insight_id?: string
          leads?: number | null
          purchase_value?: number | null
          purchases?: number | null
          raw?: Json | null
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_insights_breakdown_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "campaign_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_spend: {
        Row: {
          amount_spent: number
          campaign_id: string | null
          campaign_name: string | null
          campaign_status: string | null
          channel: string
          clicks: number
          created_at: string
          created_by: string | null
          id: string
          impressions: number
          leads_generated: number
          notes: string | null
          period_end: string
          period_start: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          amount_spent?: number
          campaign_id?: string | null
          campaign_name?: string | null
          campaign_status?: string | null
          channel?: string
          clicks?: number
          created_at?: string
          created_by?: string | null
          id?: string
          impressions?: number
          leads_generated?: number
          notes?: string | null
          period_end: string
          period_start: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_spent?: number
          campaign_id?: string | null
          campaign_name?: string | null
          campaign_status?: string | null
          channel?: string
          clicks?: number
          created_at?: string
          created_by?: string | null
          id?: string
          impressions?: number
          leads_generated?: number
          notes?: string | null
          period_end?: string
          period_start?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_spend_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_leads: {
        Row: {
          arrival_date: string | null
          attended: string | null
          channel: string | null
          contact_count: number
          created_at: string
          email: string | null
          evaluation_attended: boolean
          evaluation_attended_at: string | null
          evaluation_date: string | null
          evaluation_scheduled_at: string | null
          facebook_campaign_id: string | null
          facebook_lead_id: string | null
          first_contact_date: string | null
          full_name: string
          id: string
          international: boolean
          last_contact_at: string | null
          last_contact_by: string | null
          lead_type: string | null
          metadata: Json
          negotiation_value: number | null
          notes: string | null
          payment_method: string | null
          procedure_interest: string | null
          product: string | null
          responsible_role: string | null
          responsible_user_id: string | null
          sale_amount: number | null
          seller_name: string | null
          source_landing_page: string | null
          stage: string
          status: string
          tags: string[]
          tenant_id: string
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          whatsapp: string
        }
        Insert: {
          arrival_date?: string | null
          attended?: string | null
          channel?: string | null
          contact_count?: number
          created_at?: string
          email?: string | null
          evaluation_attended?: boolean
          evaluation_attended_at?: string | null
          evaluation_date?: string | null
          evaluation_scheduled_at?: string | null
          facebook_campaign_id?: string | null
          facebook_lead_id?: string | null
          first_contact_date?: string | null
          full_name: string
          id?: string
          international?: boolean
          last_contact_at?: string | null
          last_contact_by?: string | null
          lead_type?: string | null
          metadata?: Json
          negotiation_value?: number | null
          notes?: string | null
          payment_method?: string | null
          procedure_interest?: string | null
          product?: string | null
          responsible_role?: string | null
          responsible_user_id?: string | null
          sale_amount?: number | null
          seller_name?: string | null
          source_landing_page?: string | null
          stage?: string
          status?: string
          tags?: string[]
          tenant_id: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          whatsapp: string
        }
        Update: {
          arrival_date?: string | null
          attended?: string | null
          channel?: string | null
          contact_count?: number
          created_at?: string
          email?: string | null
          evaluation_attended?: boolean
          evaluation_attended_at?: string | null
          evaluation_date?: string | null
          evaluation_scheduled_at?: string | null
          facebook_campaign_id?: string | null
          facebook_lead_id?: string | null
          first_contact_date?: string | null
          full_name?: string
          id?: string
          international?: boolean
          last_contact_at?: string | null
          last_contact_by?: string | null
          lead_type?: string | null
          metadata?: Json
          negotiation_value?: number | null
          notes?: string | null
          payment_method?: string | null
          procedure_interest?: string | null
          product?: string | null
          responsible_role?: string | null
          responsible_user_id?: string | null
          sale_amount?: number | null
          seller_name?: string | null
          source_landing_page?: string | null
          stage?: string
          status?: string
          tags?: string[]
          tenant_id?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          foto_url: string | null
          id: string
          lead_id: string | null
          nao_lidas: number
          nome_contato: string | null
          provider: string | null
          remote_jid: string | null
          telefone: string
          tenant_id: string | null
          ultima_interacao: string | null
          ultima_mensagem: string | null
        }
        Insert: {
          created_at?: string
          foto_url?: string | null
          id?: string
          lead_id?: string | null
          nao_lidas?: number
          nome_contato?: string | null
          provider?: string | null
          remote_jid?: string | null
          telefone: string
          tenant_id?: string | null
          ultima_interacao?: string | null
          ultima_mensagem?: string | null
        }
        Update: {
          created_at?: string
          foto_url?: string | null
          id?: string
          lead_id?: string | null
          nao_lidas?: number
          nome_contato?: string | null
          provider?: string | null
          remote_jid?: string | null
          telefone?: string
          tenant_id?: string | null
          ultima_interacao?: string | null
          ultima_mensagem?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluations: {
        Row: {
          amount: number | null
          attended: string
          created_at: string
          id: string
          notes: string | null
          outcome: string | null
          patient_name: string
          scheduled_for: string
          tenant_id: string
        }
        Insert: {
          amount?: number | null
          attended?: string
          created_at?: string
          id?: string
          notes?: string | null
          outcome?: string | null
          patient_name: string
          scheduled_for: string
          tenant_id: string
        }
        Update: {
          amount?: number | null
          attended?: string
          created_at?: string
          id?: string
          notes?: string | null
          outcome?: string | null
          patient_name?: string
          scheduled_for?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evaluations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      facebook_webhook_config: {
        Row: {
          ad_account_id: string | null
          app_id: string | null
          app_secret: string | null
          connected_page_name: string | null
          created_at: string
          cron_token: string | null
          default_tenant_id: string | null
          id: string
          last_campaigns_sync_at: string | null
          last_leads_sync_at: string | null
          last_validated_at: string | null
          last_validation_result: Json | null
          page_access_token: string | null
          page_id: string | null
          token_expires_at: string | null
          updated_at: string
          user_access_token: string | null
          user_token_expires_at: string | null
          verify_token: string
        }
        Insert: {
          ad_account_id?: string | null
          app_id?: string | null
          app_secret?: string | null
          connected_page_name?: string | null
          created_at?: string
          cron_token?: string | null
          default_tenant_id?: string | null
          id?: string
          last_campaigns_sync_at?: string | null
          last_leads_sync_at?: string | null
          last_validated_at?: string | null
          last_validation_result?: Json | null
          page_access_token?: string | null
          page_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_access_token?: string | null
          user_token_expires_at?: string | null
          verify_token: string
        }
        Update: {
          ad_account_id?: string | null
          app_id?: string | null
          app_secret?: string | null
          connected_page_name?: string | null
          created_at?: string
          cron_token?: string | null
          default_tenant_id?: string | null
          id?: string
          last_campaigns_sync_at?: string | null
          last_leads_sync_at?: string | null
          last_validated_at?: string | null
          last_validation_result?: Json | null
          page_access_token?: string | null
          page_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_access_token?: string | null
          user_token_expires_at?: string | null
          verify_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "facebook_webhook_config_default_tenant_id_fkey"
            columns: ["default_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      facebook_webhook_events: {
        Row: {
          ad_id: string | null
          campaign_id: string | null
          error: string | null
          form_id: string | null
          id: string
          lead_id: string | null
          leadgen_id: string | null
          page_id: string | null
          processed: boolean
          raw_body: Json | null
          received_at: string
          signature_valid: boolean | null
        }
        Insert: {
          ad_id?: string | null
          campaign_id?: string | null
          error?: string | null
          form_id?: string | null
          id?: string
          lead_id?: string | null
          leadgen_id?: string | null
          page_id?: string | null
          processed?: boolean
          raw_body?: Json | null
          received_at?: string
          signature_valid?: boolean | null
        }
        Update: {
          ad_id?: string | null
          campaign_id?: string | null
          error?: string | null
          form_id?: string | null
          id?: string
          lead_id?: string | null
          leadgen_id?: string | null
          page_id?: string | null
          processed?: boolean
          raw_body?: Json | null
          received_at?: string
          signature_valid?: boolean | null
        }
        Relationships: []
      }
      lead_routing_rules: {
        Row: {
          active: boolean
          ad_account_id: string | null
          created_at: string
          id: string
          match_label: string | null
          match_type: string
          match_value: string
          notes: string | null
          priority: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          ad_account_id?: string | null
          created_at?: string
          id?: string
          match_label?: string | null
          match_type: string
          match_value: string
          notes?: string | null
          priority?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          ad_account_id?: string | null
          created_at?: string
          id?: string
          match_label?: string | null
          match_type?: string
          match_value?: string
          notes?: string | null
          priority?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_routing_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          cidade_estado: string | null
          cnpj: string | null
          created_at: string | null
          email: string | null
          especialidade: string | null
          expectativa_investimento: string | null
          extras: Json
          facebook_ad_id: string | null
          facebook_ad_name: string | null
          facebook_adset_id: string | null
          facebook_adset_name: string | null
          facebook_campaign: string | null
          facebook_form_id: string | null
          facebook_form_name: string | null
          facebook_lead_id: string | null
          faturamento_mensal: string | null
          fechado_em: string | null
          id: string
          investiu_trafego: string | null
          is_organic: boolean
          ja_realizou_procedimento: string | null
          motivo_perda: string | null
          mql: boolean | null
          nome_completo: string
          nome_empresa: string | null
          num_profissionais: string | null
          observacoes: string | null
          origem: string | null
          proposta_enviada_em: string | null
          reuniao_agendada_em: string | null
          reuniao_realizada_em: string | null
          revendedor_iniciante: boolean
          sql_qualified: boolean | null
          status: string
          tenant_id: string | null
          tipo_purchase: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          valor_proposta: number | null
          whatsapp: string
        }
        Insert: {
          cidade_estado?: string | null
          cnpj?: string | null
          created_at?: string | null
          email?: string | null
          especialidade?: string | null
          expectativa_investimento?: string | null
          extras?: Json
          facebook_ad_id?: string | null
          facebook_ad_name?: string | null
          facebook_adset_id?: string | null
          facebook_adset_name?: string | null
          facebook_campaign?: string | null
          facebook_form_id?: string | null
          facebook_form_name?: string | null
          facebook_lead_id?: string | null
          faturamento_mensal?: string | null
          fechado_em?: string | null
          id?: string
          investiu_trafego?: string | null
          is_organic?: boolean
          ja_realizou_procedimento?: string | null
          motivo_perda?: string | null
          mql?: boolean | null
          nome_completo: string
          nome_empresa?: string | null
          num_profissionais?: string | null
          observacoes?: string | null
          origem?: string | null
          proposta_enviada_em?: string | null
          reuniao_agendada_em?: string | null
          reuniao_realizada_em?: string | null
          revendedor_iniciante?: boolean
          sql_qualified?: boolean | null
          status?: string
          tenant_id?: string | null
          tipo_purchase?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          valor_proposta?: number | null
          whatsapp: string
        }
        Update: {
          cidade_estado?: string | null
          cnpj?: string | null
          created_at?: string | null
          email?: string | null
          especialidade?: string | null
          expectativa_investimento?: string | null
          extras?: Json
          facebook_ad_id?: string | null
          facebook_ad_name?: string | null
          facebook_adset_id?: string | null
          facebook_adset_name?: string | null
          facebook_campaign?: string | null
          facebook_form_id?: string | null
          facebook_form_name?: string | null
          facebook_lead_id?: string | null
          faturamento_mensal?: string | null
          fechado_em?: string | null
          id?: string
          investiu_trafego?: string | null
          is_organic?: boolean
          ja_realizou_procedimento?: string | null
          motivo_perda?: string | null
          mql?: boolean | null
          nome_completo?: string
          nome_empresa?: string | null
          num_profissionais?: string | null
          observacoes?: string | null
          origem?: string | null
          proposta_enviada_em?: string | null
          reuniao_agendada_em?: string | null
          reuniao_realizada_em?: string | null
          revendedor_iniciante?: boolean
          sql_qualified?: boolean | null
          status?: string
          tenant_id?: string | null
          tipo_purchase?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          valor_proposta?: number | null
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_records: {
        Row: {
          aesthetic_history: string | null
          allergies: string | null
          attachments: Json | null
          chief_complaint: string | null
          consent_signed: boolean | null
          consent_signed_at: string | null
          created_at: string
          created_by: string | null
          diagnosis: string | null
          exam_findings: string | null
          id: string
          lead_id: string | null
          medical_history: string | null
          medications: string | null
          notes: string | null
          patient_id: string | null
          professional_name: string | null
          record_type: string
          tenant_id: string
          treatment_plan: string | null
          updated_at: string
        }
        Insert: {
          aesthetic_history?: string | null
          allergies?: string | null
          attachments?: Json | null
          chief_complaint?: string | null
          consent_signed?: boolean | null
          consent_signed_at?: string | null
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          exam_findings?: string | null
          id?: string
          lead_id?: string | null
          medical_history?: string | null
          medications?: string | null
          notes?: string | null
          patient_id?: string | null
          professional_name?: string | null
          record_type?: string
          tenant_id: string
          treatment_plan?: string | null
          updated_at?: string
        }
        Update: {
          aesthetic_history?: string | null
          allergies?: string | null
          attachments?: Json | null
          chief_complaint?: string | null
          consent_signed?: boolean | null
          consent_signed_at?: string | null
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          exam_findings?: string | null
          id?: string
          lead_id?: string | null
          medical_history?: string | null
          medications?: string | null
          notes?: string | null
          patient_id?: string | null
          professional_name?: string | null
          record_type?: string
          tenant_id?: string
          treatment_plan?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_records_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "clinic_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          conteudo: string
          conversation_id: string
          created_at: string
          direction: string | null
          id: string
          lida: boolean
          media_url: string | null
          sender: string
          status: string | null
          tenant_id: string | null
          tipo: string
          wamid: string | null
        }
        Insert: {
          conteudo: string
          conversation_id: string
          created_at?: string
          direction?: string | null
          id?: string
          lida?: boolean
          media_url?: string | null
          sender: string
          status?: string | null
          tenant_id?: string | null
          tipo?: string
          wamid?: string | null
        }
        Update: {
          conteudo?: string
          conversation_id?: string
          created_at?: string
          direction?: string | null
          id?: string
          lida?: boolean
          media_url?: string | null
          sender?: string
          status?: string | null
          tenant_id?: string | null
          tipo?: string
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_goals: {
        Row: {
          created_at: string
          goal_1: number
          goal_2: number
          goal_3: number
          id: string
          month: number
          tenant_id: string
          year: number
        }
        Insert: {
          created_at?: string
          goal_1?: number
          goal_2?: number
          goal_3?: number
          id?: string
          month: number
          tenant_id: string
          year: number
        }
        Update: {
          created_at?: string
          goal_1?: number
          goal_2?: number
          goal_3?: number
          id?: string
          month?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_goals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      page_views: {
        Row: {
          created_at: string
          id: string
          path: string
          referrer: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          path?: string
          referrer?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          path?: string
          referrer?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      patient_tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          patient_id: string
          tag: string
          tenant_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          patient_id: string
          tag: string
          tenant_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          patient_id?: string
          tag?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_tags_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
          observacoes: string | null
          origem: string | null
          primeiro_contato: string | null
          recorrente: boolean
          status: string
          tenant_id: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          name: string
          observacoes?: string | null
          origem?: string | null
          primeiro_contato?: string | null
          recorrente?: boolean
          status?: string
          tenant_id: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          observacoes?: string | null
          origem?: string | null
          primeiro_contato?: string | null
          recorrente?: boolean
          status?: string
          tenant_id?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      posion_contracts: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          monthly_fee: number
          notes: string | null
          plan_name: string | null
          setup_fee: number
          start_date: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          monthly_fee?: number
          notes?: string | null
          plan_name?: string | null
          setup_fee?: number
          start_date?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          monthly_fee?: number
          notes?: string | null
          plan_name?: string | null
          setup_fee?: number
          start_date?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posion_contracts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      procedures: {
        Row: {
          active: boolean
          category: string
          created_at: string
          id: string
          name: string
          sort_order: number
          tenant_id: string
          ticket_avg: number | null
          ticket_max: number | null
          ticket_min: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
          ticket_avg?: number | null
          ticket_max?: number | null
          ticket_min?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
          ticket_avg?: number | null
          ticket_max?: number | null
          ticket_min?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      qualification_criteria: {
        Row: {
          active: boolean
          created_at: string
          disqualify_values: Json
          field: string
          id: string
          label: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          disqualify_values?: Json
          field: string
          id?: string
          label: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          disqualify_values?: Json
          field?: string
          id?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      qualification_fields: {
        Row: {
          active: boolean
          created_at: string
          db_column: string | null
          disqualify_values: Json
          id: string
          key: string
          label: string
          options: Json
          placeholder: string | null
          position: number
          question: string
          required: boolean
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          db_column?: string | null
          disqualify_values?: Json
          id?: string
          key: string
          label: string
          options?: Json
          placeholder?: string | null
          position?: number
          question: string
          required?: boolean
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          db_column?: string | null
          disqualify_values?: Json
          id?: string
          key?: string
          label?: string
          options?: Json
          placeholder?: string | null
          position?: number
          question?: string
          required?: boolean
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      recall_campaigns: {
        Row: {
          active: boolean
          created_at: string
          id: string
          message_template: string
          name: string
          procedure_id: string | null
          send_window_end: string | null
          send_window_start: string | null
          tenant_id: string
          trigger_days: number | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          message_template: string
          name: string
          procedure_id?: string | null
          send_window_end?: string | null
          send_window_start?: string | null
          tenant_id: string
          trigger_days?: number | null
          trigger_type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          message_template?: string
          name?: string
          procedure_id?: string | null
          send_window_end?: string | null
          send_window_start?: string | null
          tenant_id?: string
          trigger_days?: number | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recall_campaigns_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recall_campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      recall_executions: {
        Row: {
          campaign_id: string
          converted_at: string | null
          created_at: string
          error_message: string | null
          id: string
          lead_id: string | null
          patient_id: string | null
          rendered_message: string | null
          replied_at: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string
          tenant_id: string
          whatsapp: string | null
        }
        Insert: {
          campaign_id: string
          converted_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string | null
          patient_id?: string | null
          rendered_message?: string | null
          replied_at?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          tenant_id: string
          whatsapp?: string | null
        }
        Update: {
          campaign_id?: string
          converted_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string | null
          patient_id?: string | null
          rendered_message?: string | null
          replied_at?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          tenant_id?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recall_executions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "recall_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recall_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "clinic_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recall_executions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recall_executions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_contracts: {
        Row: {
          billing_cycle: string
          canceled_at: string | null
          created_at: string
          id: string
          mrr: number
          notes: string | null
          plan: string
          renews_at: string | null
          started_at: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          billing_cycle?: string
          canceled_at?: string | null
          created_at?: string
          id?: string
          mrr?: number
          notes?: string | null
          plan?: string
          renews_at?: string | null
          started_at?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          billing_cycle?: string
          canceled_at?: string | null
          created_at?: string
          id?: string
          mrr?: number
          notes?: string | null
          plan?: string
          renews_at?: string | null
          started_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_contracts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          amount: number
          amount_paid: number
          amount_pending: number
          attended: string | null
          category: string | null
          channel: string | null
          channel_origin: string | null
          clinic_lead_id: string | null
          completed: boolean
          completed_date: string | null
          created_at: string
          facebook_campaign_id: string | null
          first_contact_date: string | null
          id: string
          international: boolean
          metadata: Json
          notes: string | null
          patient_id: string | null
          patient_name: string
          payment_method: string | null
          payment_status: string
          procedure_category: string | null
          procedure_id: string | null
          procedure_name: string | null
          product: string | null
          sale_date: string
          scheduled_date: string | null
          seller_id: string | null
          seller_name: string | null
          tenant_id: string
          updated_at: string
          utm_campaign: string | null
          utm_source: string | null
        }
        Insert: {
          amount?: number
          amount_paid?: number
          amount_pending?: number
          attended?: string | null
          category?: string | null
          channel?: string | null
          channel_origin?: string | null
          clinic_lead_id?: string | null
          completed?: boolean
          completed_date?: string | null
          created_at?: string
          facebook_campaign_id?: string | null
          first_contact_date?: string | null
          id?: string
          international?: boolean
          metadata?: Json
          notes?: string | null
          patient_id?: string | null
          patient_name: string
          payment_method?: string | null
          payment_status?: string
          procedure_category?: string | null
          procedure_id?: string | null
          procedure_name?: string | null
          product?: string | null
          sale_date: string
          scheduled_date?: string | null
          seller_id?: string | null
          seller_name?: string | null
          tenant_id: string
          updated_at?: string
          utm_campaign?: string | null
          utm_source?: string | null
        }
        Update: {
          amount?: number
          amount_paid?: number
          amount_pending?: number
          attended?: string | null
          category?: string | null
          channel?: string | null
          channel_origin?: string | null
          clinic_lead_id?: string | null
          completed?: boolean
          completed_date?: string | null
          created_at?: string
          facebook_campaign_id?: string | null
          first_contact_date?: string | null
          id?: string
          international?: boolean
          metadata?: Json
          notes?: string | null
          patient_id?: string | null
          patient_name?: string
          payment_method?: string | null
          payment_status?: string
          procedure_category?: string | null
          procedure_id?: string | null
          procedure_name?: string | null
          product?: string | null
          sale_date?: string
          scheduled_date?: string | null
          seller_id?: string | null
          seller_name?: string | null
          tenant_id?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_clinic_lead_id_fkey"
            columns: ["clinic_lead_id"]
            isOneToOne: false
            referencedRelation: "clinic_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sellers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sellers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_users: {
        Row: {
          active: boolean
          created_at: string
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          plan: string
          segment: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          plan?: string
          segment?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          plan?: string
          segment?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_connections: {
        Row: {
          access_token: string | null
          app_secret: string | null
          business_account_name: string | null
          created_at: string
          display_name: string | null
          display_phone_number: string | null
          id: string
          is_default: boolean
          last_error: string | null
          last_validated_at: string | null
          metadata: Json
          phone_number_id: string | null
          provider: string
          status: string
          tenant_id: string | null
          token_expires_at: string | null
          updated_at: string
          verify_token: string | null
          waba_id: string | null
          webhook_subscribed: boolean
        }
        Insert: {
          access_token?: string | null
          app_secret?: string | null
          business_account_name?: string | null
          created_at?: string
          display_name?: string | null
          display_phone_number?: string | null
          id?: string
          is_default?: boolean
          last_error?: string | null
          last_validated_at?: string | null
          metadata?: Json
          phone_number_id?: string | null
          provider: string
          status?: string
          tenant_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
          verify_token?: string | null
          waba_id?: string | null
          webhook_subscribed?: boolean
        }
        Update: {
          access_token?: string | null
          app_secret?: string | null
          business_account_name?: string | null
          created_at?: string
          display_name?: string | null
          display_phone_number?: string | null
          id?: string
          is_default?: boolean
          last_error?: string | null
          last_validated_at?: string | null
          metadata?: Json
          phone_number_id?: string | null
          provider?: string
          status?: string
          tenant_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
          verify_token?: string | null
          waba_id?: string | null
          webhook_subscribed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      zapi_connections: {
        Row: {
          api_key: string | null
          client_token: string
          created_at: string
          id: string
          instance_id: string
          instance_name: string | null
          instance_url: string | null
          provider: string
          status: string
          tenant_id: string | null
          token: string
          updated_at: string
          webhook_secret: string | null
          webhook_url: string | null
        }
        Insert: {
          api_key?: string | null
          client_token: string
          created_at?: string
          id?: string
          instance_id: string
          instance_name?: string | null
          instance_url?: string | null
          provider?: string
          status?: string
          tenant_id?: string | null
          token: string
          updated_at?: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Update: {
          api_key?: string | null
          client_token?: string
          created_at?: string
          id?: string
          instance_id?: string
          instance_name?: string | null
          instance_url?: string | null
          provider?: string
          status?: string
          tenant_id?: string | null
          token?: string
          updated_at?: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zapi_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      whatsapp_connections_public: {
        Row: {
          business_account_name: string | null
          created_at: string | null
          display_name: string | null
          display_phone_number: string | null
          id: string | null
          is_default: boolean | null
          last_validated_at: string | null
          provider: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          webhook_subscribed: boolean | null
        }
        Insert: {
          business_account_name?: string | null
          created_at?: string | null
          display_name?: string | null
          display_phone_number?: string | null
          id?: string | null
          is_default?: boolean | null
          last_validated_at?: string | null
          provider?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          webhook_subscribed?: boolean | null
        }
        Update: {
          business_account_name?: string | null
          created_at?: string | null
          display_name?: string | null
          display_phone_number?: string | null
          id?: string | null
          is_default?: boolean | null
          last_validated_at?: string | null
          provider?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          webhook_subscribed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_tenant_ids: { Args: never; Returns: string[] }
      get_facebook_config_meta: {
        Args: never
        Returns: {
          ad_account_id: string
          app_id: string
          connected_page_name: string
          default_tenant_id: string
          has_app_secret: boolean
          has_page_access_token: boolean
          has_user_access_token: boolean
          id: string
          last_campaigns_sync_at: string
          last_leads_sync_at: string
          last_validated_at: string
          last_validation_result: Json
          page_id: string
          token_expires_at: string
          updated_at: string
          user_token_expires_at: string
          verify_token: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tenant_access: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_tenant_admin: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      tenant_role: "owner" | "admin" | "vendedor" | "recepcao" | "viewer"
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
      app_role: ["admin", "user"],
      tenant_role: ["owner", "admin", "vendedor", "recepcao", "viewer"],
    },
  },
} as const
