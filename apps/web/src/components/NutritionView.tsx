import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createNutritionCustomFood,
  createNutritionMeal,
  createNutritionMealPlanBlock,
  deleteNutritionCustomFood,
  deleteNutritionMeal,
  deleteNutritionMealPlanBlock,
  getNutritionCustomFoods,
  getNutritionMealPlan,
  getNutritionMeals,
  getNutritionSummary,
  upsertNutritionTargetProfile,
  updateNutritionCustomFood,
  updateNutritionMeal,
  upsertNutritionMealPlanBlock
} from "../lib/api";
import {
  NutritionCustomFood,
  NutritionDailySummary,
  NutritionMeal,
  NutritionMealPlanBlock,
  NutritionTargetProfile,
  NutritionMealType
} from "../types";
import { hapticSuccess } from "../lib/haptics";

interface MealDraft {
  name: string;
  mealType: NutritionMealType;
  calories: string;
  proteinGrams: string;
  carbsGrams: string;
  fatGrams: string;
  notes: string;
}

interface MealPlanDraft {
  title: string;
  scheduledFor: string;
  targetCalories: string;
  targetProteinGrams: string;
  targetCarbsGrams: string;
  targetFatGrams: string;
  notes: string;
}

interface CustomFoodDraft {
  name: string;
  unitLabel: string;
  caloriesPerUnit: string;
  proteinGramsPerUnit: string;
  carbsGramsPerUnit: string;
  fatGramsPerUnit: string;
}

interface NutritionTargetDraft {
  weightKg: string;
  maintenanceCalories: string;
  surplusCalories: string;
  targetCalories: string;
  targetProteinGrams: string;
  targetCarbsGrams: string;
  targetFatGrams: string;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toIsoFromDatetimeLocal(value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function toLocalDatetimeInput(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function scaleMealPortion(meal: NutritionMeal, factor: number): NutritionMeal {
  return {
    ...meal,
    calories: Math.max(0, Math.round(meal.calories * factor)),
    proteinGrams: Math.max(0, roundToTenth(meal.proteinGrams * factor)),
    carbsGrams: Math.max(0, roundToTenth(meal.carbsGrams * factor)),
    fatGrams: Math.max(0, roundToTenth(meal.fatGrams * factor))
  };
}

function computeMealTotals(meals: NutritionMeal[]): NutritionDailySummary["totals"] {
  return meals.reduce(
    (totals, meal) => ({
      calories: totals.calories + meal.calories,
      proteinGrams: roundToTenth(totals.proteinGrams + meal.proteinGrams),
      carbsGrams: roundToTenth(totals.carbsGrams + meal.carbsGrams),
      fatGrams: roundToTenth(totals.fatGrams + meal.fatGrams)
    }),
    {
      calories: 0,
      proteinGrams: 0,
      carbsGrams: 0,
      fatGrams: 0
    }
  );
}

function withMealsSummary(
  previous: NutritionDailySummary | null,
  meals: NutritionMeal[]
): NutritionDailySummary | null {
  if (!previous) {
    return previous;
  }

  const totals = computeMealTotals(meals);
  const target = previous.targetProfile;
  const remainingToTarget =
    target && typeof target.targetCalories === "number"
      ? {
          calories: roundToTenth(target.targetCalories - totals.calories),
          proteinGrams: roundToTenth((target.targetProteinGrams ?? 0) - totals.proteinGrams),
          carbsGrams: roundToTenth((target.targetCarbsGrams ?? 0) - totals.carbsGrams),
          fatGrams: roundToTenth((target.targetFatGrams ?? 0) - totals.fatGrams)
        }
      : null;

  return {
    ...previous,
    totals,
    remainingToTarget,
    mealsLogged: meals.length,
    meals
  };
}

function toNumberString(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

function toTargetDraft(profile: NutritionTargetProfile | null): NutritionTargetDraft {
  if (!profile) {
    return {
      weightKg: "",
      maintenanceCalories: "",
      surplusCalories: "",
      targetCalories: "",
      targetProteinGrams: "",
      targetCarbsGrams: "",
      targetFatGrams: ""
    };
  }

  return {
    weightKg: toNumberString(profile.weightKg),
    maintenanceCalories: toNumberString(profile.maintenanceCalories),
    surplusCalories: toNumberString(profile.surplusCalories),
    targetCalories: toNumberString(profile.targetCalories),
    targetProteinGrams: toNumberString(profile.targetProteinGrams),
    targetCarbsGrams: toNumberString(profile.targetCarbsGrams),
    targetFatGrams: toNumberString(profile.targetFatGrams)
  };
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveTargetsFromDraft(draft: NutritionTargetDraft): {
  targetCalories: number;
  targetProteinGrams: number;
  targetCarbsGrams: number;
  targetFatGrams: number;
} | null {
  const weightKg = parseOptionalNumber(draft.weightKg);
  const maintenanceCalories = parseOptionalNumber(draft.maintenanceCalories);
  const surplusCalories = parseOptionalNumber(draft.surplusCalories);

  const hasBase = weightKg !== null && maintenanceCalories !== null && surplusCalories !== null;
  let targetCalories: number | null = null;
  let targetProteinGrams: number | null = null;
  let targetCarbsGrams: number | null = null;
  let targetFatGrams: number | null = null;

  if (hasBase) {
    const weightLb = weightKg * 2.2046226218;
    targetCalories = roundToTenth(maintenanceCalories + surplusCalories);
    targetProteinGrams = roundToTenth(weightLb * 0.8);
    targetFatGrams = roundToTenth(weightLb * 0.4);
    const remainingCalories = Math.max(0, targetCalories - targetProteinGrams * 4 - targetFatGrams * 9);
    targetCarbsGrams = roundToTenth(remainingCalories / 4);
  }

  const overrideCalories = parseOptionalNumber(draft.targetCalories);
  const overrideProtein = parseOptionalNumber(draft.targetProteinGrams);
  const overrideCarbs = parseOptionalNumber(draft.targetCarbsGrams);
  const overrideFat = parseOptionalNumber(draft.targetFatGrams);

  if (overrideCalories !== null) targetCalories = roundToTenth(overrideCalories);
  if (overrideProtein !== null) targetProteinGrams = roundToTenth(overrideProtein);
  if (overrideCarbs !== null) targetCarbsGrams = roundToTenth(overrideCarbs);
  if (overrideFat !== null) targetFatGrams = roundToTenth(overrideFat);

  if (
    targetCalories === null ||
    targetProteinGrams === null ||
    targetCarbsGrams === null ||
    targetFatGrams === null
  ) {
    return null;
  }

  return {
    targetCalories,
    targetProteinGrams,
    targetCarbsGrams,
    targetFatGrams
  };
}

function completeTargetsFromProfile(profile: NutritionTargetProfile | null): {
  targetCalories: number;
  targetProteinGrams: number;
  targetCarbsGrams: number;
  targetFatGrams: number;
} | null {
  if (
    !profile ||
    typeof profile.targetCalories !== "number" ||
    typeof profile.targetProteinGrams !== "number" ||
    typeof profile.targetCarbsGrams !== "number" ||
    typeof profile.targetFatGrams !== "number"
  ) {
    return null;
  }

  return {
    targetCalories: roundToTenth(profile.targetCalories),
    targetProteinGrams: roundToTenth(profile.targetProteinGrams),
    targetCarbsGrams: roundToTenth(profile.targetCarbsGrams),
    targetFatGrams: roundToTenth(profile.targetFatGrams)
  };
}

function formatMetric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatSignedDelta(value: number, unit: string): string {
  const rounded = roundToTenth(value);
  if (Math.abs(rounded) < 0.1) {
    return "On target";
  }

  return `${rounded > 0 ? "+" : ""}${formatMetric(rounded)}${unit}`;
}

function deltaToneClass(value: number): string {
  const rounded = roundToTenth(value);
  if (Math.abs(rounded) < 0.1) {
    return "nutrition-delta-neutral";
  }
  return rounded > 0 ? "nutrition-delta-positive" : "nutrition-delta-negative";
}

export function NutritionView(): JSX.Element {
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const [summary, setSummary] = useState<NutritionDailySummary | null>(null);
  const [meals, setMeals] = useState<NutritionMeal[]>([]);
  const [mealPlanBlocks, setMealPlanBlocks] = useState<NutritionMealPlanBlock[]>([]);
  const [customFoods, setCustomFoods] = useState<NutritionCustomFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [editingCustomFoodId, setEditingCustomFoodId] = useState<string | null>(null);
  const [targetDraft, setTargetDraft] = useState<NutritionTargetDraft>(() => toTargetDraft(null));
  const [targetDraftDirty, setTargetDraftDirty] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);

  const [mealDraft, setMealDraft] = useState<MealDraft>({
    name: "",
    mealType: "other",
    calories: "",
    proteinGrams: "",
    carbsGrams: "",
    fatGrams: "",
    notes: ""
  });

  const [planDraft, setPlanDraft] = useState<MealPlanDraft>({
    title: "",
    scheduledFor: toLocalDatetimeInput(new Date().toISOString()),
    targetCalories: "",
    targetProteinGrams: "",
    targetCarbsGrams: "",
    targetFatGrams: "",
    notes: ""
  });

  const [customFoodDraft, setCustomFoodDraft] = useState<CustomFoodDraft>({
    name: "",
    unitLabel: "serving",
    caloriesPerUnit: "",
    proteinGramsPerUnit: "",
    carbsGramsPerUnit: "",
    fatGramsPerUnit: ""
  });

  const derivedTargets = useMemo(() => deriveTargetsFromDraft(targetDraft), [targetDraft]);
  const activeTargets = useMemo(
    () => derivedTargets ?? completeTargetsFromProfile(summary?.targetProfile ?? null),
    [derivedTargets, summary?.targetProfile]
  );
  const intakeDeltas = useMemo(() => {
    if (!summary || !activeTargets) {
      return null;
    }

    return {
      calories: roundToTenth(summary.totals.calories - activeTargets.targetCalories),
      proteinGrams: roundToTenth(summary.totals.proteinGrams - activeTargets.targetProteinGrams),
      carbsGrams: roundToTenth(summary.totals.carbsGrams - activeTargets.targetCarbsGrams),
      fatGrams: roundToTenth(summary.totals.fatGrams - activeTargets.targetFatGrams)
    };
  }, [summary, activeTargets]);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    const [nextSummary, nextMeals, nextPlanBlocks, nextCustomFoods] = await Promise.all([
      getNutritionSummary(todayKey),
      getNutritionMeals({ date: todayKey }),
      getNutritionMealPlan({ date: todayKey }),
      getNutritionCustomFoods({ limit: 200 })
    ]);

    setSummary(nextSummary);
    setMeals(nextMeals);
    setMealPlanBlocks(nextPlanBlocks);
    setCustomFoods(nextCustomFoods);
    if (!targetDraftDirty) {
      setTargetDraft(toTargetDraft(nextSummary?.targetProfile ?? null));
    }
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const updateTargetDraftField = (field: keyof NutritionTargetDraft, value: string): void => {
    setTargetDraft((previous) => ({
      ...previous,
      [field]: value
    }));
    setTargetDraftDirty(true);
  };

  const handleResetTargets = (): void => {
    setTargetDraft(toTargetDraft(summary?.targetProfile ?? null));
    setTargetDraftDirty(false);
    setMessage("");
  };

  const handleSaveTargets = async (): Promise<void> => {
    setMessage("");
    setSavingTargets(true);

    const saved = await upsertNutritionTargetProfile({
      date: todayKey,
      weightKg: parseOptionalNumber(targetDraft.weightKg),
      maintenanceCalories: parseOptionalNumber(targetDraft.maintenanceCalories),
      surplusCalories: parseOptionalNumber(targetDraft.surplusCalories),
      targetCalories: parseOptionalNumber(targetDraft.targetCalories),
      targetProteinGrams: parseOptionalNumber(targetDraft.targetProteinGrams),
      targetCarbsGrams: parseOptionalNumber(targetDraft.targetCarbsGrams),
      targetFatGrams: parseOptionalNumber(targetDraft.targetFatGrams)
    });

    setSavingTargets(false);

    if (!saved) {
      setMessage("Could not save macro targets right now.");
      return;
    }

    hapticSuccess();
    setTargetDraft(toTargetDraft(saved));
    setTargetDraftDirty(false);
    setMessage("Macro targets saved.");
    await refresh();
  };

  const handleMealSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setMessage("");

    const calories = Number.parseFloat(mealDraft.calories);
    if (!mealDraft.name.trim() || !Number.isFinite(calories) || calories < 0) {
      setMessage("Enter a valid meal name and calories.");
      return;
    }

    const created = await createNutritionMeal({
      name: mealDraft.name.trim(),
      mealType: mealDraft.mealType,
      calories,
      proteinGrams: Number.parseFloat(mealDraft.proteinGrams) || 0,
      carbsGrams: Number.parseFloat(mealDraft.carbsGrams) || 0,
      fatGrams: Number.parseFloat(mealDraft.fatGrams) || 0,
      notes: mealDraft.notes.trim() || undefined
    });

    if (!created) {
      setMessage("Could not log meal right now.");
      return;
    }

    hapticSuccess();
    setMealDraft({
      name: "",
      mealType: "other",
      calories: "",
      proteinGrams: "",
      carbsGrams: "",
      fatGrams: "",
      notes: ""
    });
    await refresh();
  };

  const handleDeleteMeal = async (mealId: string): Promise<void> => {
    const deleted = await deleteNutritionMeal(mealId);
    if (!deleted) {
      setMessage("Could not delete meal right now.");
      return;
    }
    hapticSuccess();
    setMeals((previous) => {
      const nextMeals = previous.filter((meal) => meal.id !== mealId);
      setSummary((current) => withMealsSummary(current, nextMeals));
      return nextMeals;
    });
  };

  const handleAdjustMealPortion = async (mealId: string, direction: "up" | "down"): Promise<void> => {
    const currentMeal = meals.find((meal) => meal.id === mealId);
    if (!currentMeal) {
      return;
    }

    const factor = direction === "up" ? 1.25 : 0.75;
    const scaled = scaleMealPortion(currentMeal, factor);
    const updated = await updateNutritionMeal(mealId, {
      calories: scaled.calories,
      proteinGrams: scaled.proteinGrams,
      carbsGrams: scaled.carbsGrams,
      fatGrams: scaled.fatGrams
    });

    if (!updated) {
      setMessage("Could not adjust meal portion right now.");
      return;
    }

    hapticSuccess();
    setMeals((previous) => {
      const nextMeals = previous.map((meal) => (meal.id === mealId ? updated : meal));
      setSummary((current) => withMealsSummary(current, nextMeals));
      return nextMeals;
    });
  };

  const handlePlanSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setMessage("");

    const scheduledFor = toIsoFromDatetimeLocal(planDraft.scheduledFor);
    if (!planDraft.title.trim() || !scheduledFor) {
      setMessage("Enter a meal-plan title and valid time.");
      return;
    }

    const created = await createNutritionMealPlanBlock({
      title: planDraft.title.trim(),
      scheduledFor,
      ...(planDraft.targetCalories.trim()
        ? { targetCalories: Number.parseFloat(planDraft.targetCalories) || 0 }
        : {}),
      ...(planDraft.targetProteinGrams.trim()
        ? { targetProteinGrams: Number.parseFloat(planDraft.targetProteinGrams) || 0 }
        : {}),
      ...(planDraft.targetCarbsGrams.trim()
        ? { targetCarbsGrams: Number.parseFloat(planDraft.targetCarbsGrams) || 0 }
        : {}),
      ...(planDraft.targetFatGrams.trim()
        ? { targetFatGrams: Number.parseFloat(planDraft.targetFatGrams) || 0 }
        : {}),
      notes: planDraft.notes.trim() || undefined
    });

    if (!created) {
      setMessage("Could not create meal-plan block right now.");
      return;
    }

    hapticSuccess();
    setPlanDraft({
      title: "",
      scheduledFor: toLocalDatetimeInput(new Date().toISOString()),
      targetCalories: "",
      targetProteinGrams: "",
      targetCarbsGrams: "",
      targetFatGrams: "",
      notes: ""
    });
    await refresh();
  };

  const handleDeletePlanBlock = async (blockId: string): Promise<void> => {
    const deleted = await deleteNutritionMealPlanBlock(blockId);
    if (!deleted) {
      setMessage("Could not remove meal-plan block right now.");
      return;
    }
    hapticSuccess();
    await refresh();
  };

  const handleMovePlanBlock = async (blockId: string, direction: "up" | "down"): Promise<void> => {
    const index = mealPlanBlocks.findIndex((block) => block.id === blockId);
    if (index < 0) {
      return;
    }

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= mealPlanBlocks.length) {
      return;
    }

    const current = mealPlanBlocks[index]!;
    const target = mealPlanBlocks[targetIndex]!;

    const [currentUpdated, targetUpdated] = await Promise.all([
      upsertNutritionMealPlanBlock(current.id, { scheduledFor: target.scheduledFor }),
      upsertNutritionMealPlanBlock(target.id, { scheduledFor: current.scheduledFor })
    ]);

    if (!currentUpdated || !targetUpdated) {
      setMessage("Could not reorder meal-plan blocks right now.");
      return;
    }

    hapticSuccess();
    setMealPlanBlocks((previous) => {
      const next = [...previous];
      next[index] = currentUpdated;
      next[targetIndex] = targetUpdated;
      return next;
    });
  };

  const resetCustomFoodDraft = (): void => {
    setEditingCustomFoodId(null);
    setCustomFoodDraft({
      name: "",
      unitLabel: "serving",
      caloriesPerUnit: "",
      proteinGramsPerUnit: "",
      carbsGramsPerUnit: "",
      fatGramsPerUnit: ""
    });
  };

  const handleCustomFoodSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setMessage("");

    const name = customFoodDraft.name.trim();
    const caloriesPerUnit = Number.parseFloat(customFoodDraft.caloriesPerUnit);
    if (!name || !Number.isFinite(caloriesPerUnit) || caloriesPerUnit < 0) {
      setMessage("Enter a valid custom food name and calories.");
      return;
    }

    const payload = {
      name,
      unitLabel: customFoodDraft.unitLabel.trim() || "serving",
      caloriesPerUnit,
      proteinGramsPerUnit: Number.parseFloat(customFoodDraft.proteinGramsPerUnit) || 0,
      carbsGramsPerUnit: Number.parseFloat(customFoodDraft.carbsGramsPerUnit) || 0,
      fatGramsPerUnit: Number.parseFloat(customFoodDraft.fatGramsPerUnit) || 0
    };

    const saved = editingCustomFoodId
      ? await updateNutritionCustomFood(editingCustomFoodId, payload)
      : await createNutritionCustomFood(payload);

    if (!saved) {
      setMessage("Could not save custom food right now.");
      return;
    }

    hapticSuccess();
    setMessage(editingCustomFoodId ? "Custom food updated." : "Custom food created.");
    resetCustomFoodDraft();
    await refresh();
  };

  const handleEditCustomFood = (food: NutritionCustomFood): void => {
    setEditingCustomFoodId(food.id);
    setCustomFoodDraft({
      name: food.name,
      unitLabel: food.unitLabel,
      caloriesPerUnit: String(food.caloriesPerUnit),
      proteinGramsPerUnit: String(food.proteinGramsPerUnit),
      carbsGramsPerUnit: String(food.carbsGramsPerUnit),
      fatGramsPerUnit: String(food.fatGramsPerUnit)
    });
  };

  const handleDeleteCustomFood = async (foodId: string): Promise<void> => {
    const deleted = await deleteNutritionCustomFood(foodId);
    if (!deleted) {
      setMessage("Could not delete custom food right now.");
      return;
    }
    hapticSuccess();
    if (editingCustomFoodId === foodId) {
      resetCustomFoodDraft();
    }
    await refresh();
  };

  const handleUseCustomFood = (food: NutritionCustomFood): void => {
    setMealDraft((previous) => ({
      ...previous,
      name: food.name,
      calories: String(food.caloriesPerUnit),
      proteinGrams: String(food.proteinGramsPerUnit),
      carbsGrams: String(food.carbsGramsPerUnit),
      fatGrams: String(food.fatGramsPerUnit),
      notes: previous.notes.trim() ? previous.notes : `1 ${food.unitLabel}`
    }));
    setMessage(`Loaded ${food.name} into meal form.`);
  };

  return (
    <section className="nutrition-view">
      <header className="nutrition-header">
        <div>
          <p className="eyebrow">Nutrition</p>
          <h2>Meal plan</h2>
        </div>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      {message && <p className="nutrition-message">{message}</p>}

      <article className="nutrition-card">
        <div>
          <h3>Plan settings</h3>
          <p className="nutrition-item-meta">
            Set weight, maintenance, and surplus to derive your macro targets. Use overrides when you want manual targets.
          </p>
        </div>
        <div className="nutrition-form">
          <div className="nutrition-form-row nutrition-target-grid">
            <label>
              Weight (kg)
              <input
                type="number"
                min={0}
                step="0.1"
                value={targetDraft.weightKg}
                onChange={(event) => updateTargetDraftField("weightKg", event.target.value)}
              />
            </label>
            <label>
              Maintenance calories
              <input
                type="number"
                min={0}
                step="1"
                value={targetDraft.maintenanceCalories}
                onChange={(event) => updateTargetDraftField("maintenanceCalories", event.target.value)}
              />
            </label>
            <label>
              Surplus calories
              <input
                type="number"
                min={-5000}
                step="1"
                value={targetDraft.surplusCalories}
                onChange={(event) => updateTargetDraftField("surplusCalories", event.target.value)}
              />
            </label>
          </div>

          <div className="nutrition-summary-grid nutrition-target-dashboard">
            <article className="summary-tile nutrition-target-card nutrition-target-card-protein">
              <p className="summary-label">Target protein</p>
              <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetProteinGrams)}g` : "—"}</p>
            </article>
            <article className="summary-tile nutrition-target-card nutrition-target-card-carbs">
              <p className="summary-label">Target carbs</p>
              <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetCarbsGrams)}g` : "—"}</p>
            </article>
            <article className="summary-tile nutrition-target-card nutrition-target-card-fat">
              <p className="summary-label">Target fat</p>
              <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetFatGrams)}g` : "—"}</p>
            </article>
            <article className="summary-tile nutrition-target-card nutrition-target-card-calories">
              <p className="summary-label">Target calories</p>
              <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetCalories)} kcal` : "—"}</p>
            </article>
          </div>

          <div className="nutrition-form-row nutrition-target-grid">
            <label>
              Target calories (override)
              <input
                type="number"
                min={0}
                step="1"
                value={targetDraft.targetCalories}
                onChange={(event) => updateTargetDraftField("targetCalories", event.target.value)}
              />
            </label>
            <label>
              Target protein (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={targetDraft.targetProteinGrams}
                onChange={(event) => updateTargetDraftField("targetProteinGrams", event.target.value)}
              />
            </label>
            <label>
              Target carbs (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={targetDraft.targetCarbsGrams}
                onChange={(event) => updateTargetDraftField("targetCarbsGrams", event.target.value)}
              />
            </label>
            <label>
              Target fat (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={targetDraft.targetFatGrams}
                onChange={(event) => updateTargetDraftField("targetFatGrams", event.target.value)}
              />
            </label>
          </div>

          <div className="nutrition-inline-actions">
            <button type="button" onClick={() => void handleSaveTargets()} disabled={savingTargets || loading}>
              {savingTargets ? "Saving..." : "Save targets"}
            </button>
            <button
              type="button"
              className="nutrition-secondary-button"
              onClick={handleResetTargets}
              disabled={!targetDraftDirty || savingTargets}
            >
              Reset
            </button>
          </div>
        </div>
      </article>

      <article className="nutrition-card nutrition-daily-dashboard">
        <h3>Daily totals</h3>
        {loading ? (
          <p>Loading nutrition...</p>
        ) : (
          <div className="nutrition-summary-grid nutrition-daily-grid">
            <article className="nutrition-daily-metric">
              <p className="summary-label">Protein</p>
              <p className="summary-value">{summary ? `${formatMetric(summary.totals.proteinGrams)}g` : "0g"}</p>
              <p className={`nutrition-daily-delta ${intakeDeltas ? deltaToneClass(intakeDeltas.proteinGrams) : "nutrition-delta-neutral"}`}>
                {intakeDeltas ? formatSignedDelta(intakeDeltas.proteinGrams, "g") : "Set targets"}
              </p>
            </article>
            <article className="nutrition-daily-metric">
              <p className="summary-label">Carbs</p>
              <p className="summary-value">{summary ? `${formatMetric(summary.totals.carbsGrams)}g` : "0g"}</p>
              <p className={`nutrition-daily-delta ${intakeDeltas ? deltaToneClass(intakeDeltas.carbsGrams) : "nutrition-delta-neutral"}`}>
                {intakeDeltas ? formatSignedDelta(intakeDeltas.carbsGrams, "g") : "Set targets"}
              </p>
            </article>
            <article className="nutrition-daily-metric">
              <p className="summary-label">Fat</p>
              <p className="summary-value">{summary ? `${formatMetric(summary.totals.fatGrams)}g` : "0g"}</p>
              <p className={`nutrition-daily-delta ${intakeDeltas ? deltaToneClass(intakeDeltas.fatGrams) : "nutrition-delta-neutral"}`}>
                {intakeDeltas ? formatSignedDelta(intakeDeltas.fatGrams, "g") : "Set targets"}
              </p>
            </article>
            <article className="nutrition-daily-metric">
              <p className="summary-label">Calories</p>
              <p className="summary-value">{summary ? String(Math.round(summary.totals.calories)) : "0"} kcal</p>
              <p className={`nutrition-daily-delta ${intakeDeltas ? deltaToneClass(intakeDeltas.calories) : "nutrition-delta-neutral"}`}>
                {intakeDeltas ? formatSignedDelta(intakeDeltas.calories, " kcal") : "Set targets"}
              </p>
            </article>
          </div>
        )}
      </article>

      <article className="nutrition-card">
        <h3>Meal plan</h3>
        <form className="nutrition-form" onSubmit={(event) => void handlePlanSubmit(event)}>
          <div className="nutrition-form-row">
            <label>
              Title
              <input
                type="text"
                value={planDraft.title}
                onChange={(event) => setPlanDraft({ ...planDraft, title: event.target.value })}
                maxLength={160}
                required
              />
            </label>
            <label>
              Time
              <input
                type="datetime-local"
                value={planDraft.scheduledFor}
                onChange={(event) => setPlanDraft({ ...planDraft, scheduledFor: event.target.value })}
                required
              />
            </label>
          </div>
          <div className="nutrition-form-row">
            <label>
              Target kcal
              <input
                type="number"
                min={0}
                step="1"
                value={planDraft.targetCalories}
                onChange={(event) => setPlanDraft({ ...planDraft, targetCalories: event.target.value })}
              />
            </label>
            <label>
              Target protein (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={planDraft.targetProteinGrams}
                onChange={(event) => setPlanDraft({ ...planDraft, targetProteinGrams: event.target.value })}
              />
            </label>
            <label>
              Target carbs (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={planDraft.targetCarbsGrams}
                onChange={(event) => setPlanDraft({ ...planDraft, targetCarbsGrams: event.target.value })}
              />
            </label>
            <label>
              Target fat (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={planDraft.targetFatGrams}
                onChange={(event) => setPlanDraft({ ...planDraft, targetFatGrams: event.target.value })}
              />
            </label>
          </div>
          <label>
            Notes
            <input
              type="text"
              value={planDraft.notes}
              onChange={(event) => setPlanDraft({ ...planDraft, notes: event.target.value })}
              maxLength={300}
            />
          </label>
          <button type="submit">Add plan block</button>
        </form>

        {mealPlanBlocks.length === 0 ? (
          <p>No meal-plan blocks for today.</p>
        ) : (
          <div className="nutrition-list">
            {mealPlanBlocks.map((block, index) => (
              <article key={block.id} className="nutrition-list-item">
                <div>
                  <p className="nutrition-item-title">{block.title}</p>
                  <p className="nutrition-item-meta">
                    {formatDateTime(block.scheduledFor)}
                    {(block.targetCalories ?? block.targetProteinGrams ?? block.targetCarbsGrams ?? block.targetFatGrams) !==
                    undefined
                      ? ` • ${block.targetCalories ?? 0} kcal, ${block.targetProteinGrams ?? 0}P/${block.targetCarbsGrams ?? 0}C/${block.targetFatGrams ?? 0}F`
                      : ""}
                  </p>
                </div>
                <div className="nutrition-list-item-actions nutrition-quick-controls">
                  <button
                    type="button"
                    onClick={() => void handleMovePlanBlock(block.id, "up")}
                    disabled={index === 0}
                    aria-label="Move block up"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleMovePlanBlock(block.id, "down")}
                    disabled={index === mealPlanBlocks.length - 1}
                    aria-label="Move block down"
                  >
                    Down
                  </button>
                  <button type="button" onClick={() => void handleDeletePlanBlock(block.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>

      <article className="nutrition-card">
        <h3>Today&apos;s meals</h3>
        {meals.length === 0 ? (
          <p>No meals logged yet.</p>
        ) : (
          <div className="nutrition-list">
            {meals.map((meal) => (
              <article key={meal.id} className="nutrition-list-item">
                <div>
                  <p className="nutrition-item-title">
                    {meal.name} <span className="nutrition-item-type">{meal.mealType}</span>
                  </p>
                  <p className="nutrition-item-meta">
                    {meal.calories} kcal • {meal.proteinGrams}P/{meal.carbsGrams}C/{meal.fatGrams}F •{" "}
                    {formatDateTime(meal.consumedAt)}
                  </p>
                </div>
                <div className="nutrition-list-item-actions nutrition-quick-controls">
                  <button type="button" onClick={() => void handleAdjustMealPortion(meal.id, "down")} aria-label="Decrease portion">
                    -
                  </button>
                  <button type="button" onClick={() => void handleAdjustMealPortion(meal.id, "up")} aria-label="Increase portion">
                    +
                  </button>
                  <button type="button" onClick={() => void handleDeleteMeal(meal.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>

      <article className="nutrition-card">
        <h3>Log meal</h3>
        <form className="nutrition-form" onSubmit={(event) => void handleMealSubmit(event)}>
          <label>
            Meal name
            <input
              type="text"
              value={mealDraft.name}
              onChange={(event) => setMealDraft({ ...mealDraft, name: event.target.value })}
              maxLength={160}
              required
            />
          </label>
          <label>
            Type
            <select
              value={mealDraft.mealType}
              onChange={(event) =>
                setMealDraft({ ...mealDraft, mealType: event.target.value as NutritionMealType })
              }
            >
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
              <option value="snack">Snack</option>
              <option value="other">Other</option>
            </select>
          </label>
          <div className="nutrition-form-row">
            <label>
              Calories
              <input
                type="number"
                min={0}
                step="1"
                value={mealDraft.calories}
                onChange={(event) => setMealDraft({ ...mealDraft, calories: event.target.value })}
                required
              />
            </label>
            <label>
              Protein (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={mealDraft.proteinGrams}
                onChange={(event) => setMealDraft({ ...mealDraft, proteinGrams: event.target.value })}
              />
            </label>
            <label>
              Carbs (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={mealDraft.carbsGrams}
                onChange={(event) => setMealDraft({ ...mealDraft, carbsGrams: event.target.value })}
              />
            </label>
            <label>
              Fat (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={mealDraft.fatGrams}
                onChange={(event) => setMealDraft({ ...mealDraft, fatGrams: event.target.value })}
              />
            </label>
          </div>
          <label>
            Notes
            <input
              type="text"
              value={mealDraft.notes}
              onChange={(event) => setMealDraft({ ...mealDraft, notes: event.target.value })}
              maxLength={300}
            />
          </label>
          <button type="submit">Log meal</button>
        </form>
      </article>

      <article className="nutrition-card">
        <div className="nutrition-custom-food-header">
          <h3>Custom foods</h3>
          {editingCustomFoodId && (
            <button type="button" onClick={resetCustomFoodDraft}>
              Cancel edit
            </button>
          )}
        </div>
        <form className="nutrition-form" onSubmit={(event) => void handleCustomFoodSubmit(event)}>
          <div className="nutrition-form-row">
            <label>
              Name
              <input
                type="text"
                value={customFoodDraft.name}
                onChange={(event) => setCustomFoodDraft({ ...customFoodDraft, name: event.target.value })}
                maxLength={160}
                required
              />
            </label>
            <label>
              Unit
              <input
                type="text"
                value={customFoodDraft.unitLabel}
                onChange={(event) => setCustomFoodDraft({ ...customFoodDraft, unitLabel: event.target.value })}
                maxLength={40}
                required
              />
            </label>
          </div>
          <div className="nutrition-form-row">
            <label>
              Calories / unit
              <input
                type="number"
                min={0}
                step="1"
                value={customFoodDraft.caloriesPerUnit}
                onChange={(event) => setCustomFoodDraft({ ...customFoodDraft, caloriesPerUnit: event.target.value })}
                required
              />
            </label>
            <label>
              Protein / unit (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={customFoodDraft.proteinGramsPerUnit}
                onChange={(event) =>
                  setCustomFoodDraft({ ...customFoodDraft, proteinGramsPerUnit: event.target.value })
                }
              />
            </label>
            <label>
              Carbs / unit (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={customFoodDraft.carbsGramsPerUnit}
                onChange={(event) => setCustomFoodDraft({ ...customFoodDraft, carbsGramsPerUnit: event.target.value })}
              />
            </label>
            <label>
              Fat / unit (g)
              <input
                type="number"
                min={0}
                step="0.1"
                value={customFoodDraft.fatGramsPerUnit}
                onChange={(event) => setCustomFoodDraft({ ...customFoodDraft, fatGramsPerUnit: event.target.value })}
              />
            </label>
          </div>
          <button type="submit">{editingCustomFoodId ? "Update custom food" : "Save custom food"}</button>
        </form>

        {customFoods.length === 0 ? (
          <p>No custom foods yet.</p>
        ) : (
          <div className="nutrition-list">
            {customFoods.map((food) => (
              <article key={food.id} className="nutrition-list-item">
                <div>
                  <p className="nutrition-item-title">{food.name}</p>
                  <p className="nutrition-item-meta">
                    {food.caloriesPerUnit} kcal/{food.unitLabel} • {food.proteinGramsPerUnit}P/{food.carbsGramsPerUnit}
                    C/{food.fatGramsPerUnit}F
                  </p>
                </div>
                <div className="nutrition-list-item-actions">
                  <button type="button" onClick={() => handleUseCustomFood(food)}>
                    Use
                  </button>
                  <button type="button" onClick={() => handleEditCustomFood(food)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => void handleDeleteCustomFood(food.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
