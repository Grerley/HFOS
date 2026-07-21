export interface User {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  is_active: boolean;
}

export interface Household {
  id: number;
  name: string;
  base_currency: string;
  country: string;
  budget_cycle_day: number;
  role?: string | null;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
  households: Household[];
}

export interface Member {
  id: number;
  name: string;
  relationship_label?: string | null;
  role: string;
  user_id?: number | null;
  is_active: boolean;
  phone?: string | null;
  notify_email?: boolean;
  notify_whatsapp?: boolean;
}

export interface Category {
  id: number;
  name: string;
  type: "income" | "expense" | "saving" | "investment" | "transfer";
  parent_id?: number | null;
  is_section: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface Period {
  id: number;
  label: string;
  start_date: string;
  end_date: string;
  status: string;
  source?: string | null;
  notes?: string | null;
}

export interface Line {
  id: number;
  period_id: number;
  category_id: number;
  item_name: string;
  owner_member_id?: number | null;
  planned_amount_cents: number;
  actual_amount_cents: number;
  due_day?: number | null;
  due_note?: string | null;
  recurrence: string;
  payment_status: string;
  payment_type?: string;
  is_tithe?: boolean;
  is_recurring: boolean;
  priority: number;
  needs_review: boolean;
}

export interface DashboardResponse {
  has_period: boolean;
  message?: string;
  period?: { id: number; label: string; status: string; start_date: string; end_date: string };
  summary?: PeriodSummary;
  owner_cards?: OwnerCard[];
  net_worth_cents?: number;
  currency?: string;
}

export interface PeriodSummary {
  formula_version: string;
  planned: Totals;
  actual: Totals;
  variance: {
    income: Variance;
    expenses: Variance;
    net: { planned_cents: number; actual_cents: number; variance_cents: number };
  };
  category_breakdown: CategoryRow[];
  owner_positions: Record<string, { income_cents: number; expense_cents: number; net_cents: number }>;
}

export interface Totals {
  total_income_cents: number;
  total_expenses_cents: number;
  net_position_cents: number;
  total_savings_cents: number;
  savings_rate: number;
}

export interface Variance {
  planned_cents: number;
  actual_cents: number;
  variance_cents: number;
  variance_pct: number | null;
  remaining_cents: number;
}

export interface CategoryRow {
  category_id: number | null;
  category_name: string | null;
  amount_cents: number;
  pct_of_expenses: number;
}

export interface OwnerCard {
  member_id: number;
  member_name: string;
  income_cents: number;
  expense_cents: number;
  net_cents: number;
}

export interface Goal {
  id: number;
  name: string;
  goal_type?: string | null;
  target_amount_cents: number;
  current_amount_cents: number;
  target_date?: string | null;
  monthly_contribution_cents: number;
  priority: number;
  status: string;
  progress: number;
  months_remaining: number;
  monthly_required_cents: number;
}

export interface Property {
  id: number;
  name: string;
  market_value_cents: number;
  outstanding_bond_cents: number;
  rental_status: string;
  address_label?: string | null;
  ownership_share_bp?: number;
  valuation_date?: string | null;
  notes?: string | null;
}

export interface Scenario {
  id: number;
  name: string;
  base_period_id?: number | null;
  description?: string | null;
  assumptions_json: Record<string, number>;
  projected_results_json: any;
}

export interface Insight {
  id: number;
  type: string;
  severity: string;
  summary: string;
  explanation?: string | null;
  action?: string | null;
  status: string;
  evidence_json: any;
  created_at: string;
}
