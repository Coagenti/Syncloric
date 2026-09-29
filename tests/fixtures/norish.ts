/**
 * Fixtures norish per i unit test del client (§ 5) — derivate dai payload
 * verificati live del 2026-09-29 (docs/norish-api/recipe-sample-sachertorte.json).
 * Le fixture in docs/norish-api/ restano record storici: la base URL runtime
 * arriva solo da NORISH_BASE_URL (§ 5.0); qui solo la forma dei payload.
 */

export const PLANNED_RECIPE: Record<string, unknown> = {
  id: "0f0e6f5e-1111-4aaa-8bbb-000000000001",
  date: "2026-09-29",
  slot: "Breakfast",
  sortOrder: 1,
  recipeId: "1f0e6f5e-1aab-4bbb-8ccc-000000000002",
  version: 3,
  recipeName: "Sachertorte",
  recipeImage: null,
  servings: 8,
  calories: 458, // kcal PER PORZIONE (semantica verificata sui dati reali, § 5.2)
};

export const RECIPE_DETAIL: Record<string, unknown> = {
  id: "1f0e6f5e-1aab-4bbb-8ccc-000000000002",
  name: "Sachertorte",
  servings: 8,
  calories: 458,
  fat: "27.40",
  carbs: "45.10",
  protein: "5.60",
  systemUsed: "metric",
};

export const OK_HEALTH = { status: "ok" };