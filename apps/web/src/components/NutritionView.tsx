import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createNutritionCustomFood,
  createNutritionMeal,
  deleteNutritionCustomFood,
  deleteNutritionMeal,
  getNutritionCustomFoods,
  getNutritionMeals,
  getNutritionSummary,
  upsertNutritionTargetProfile,
  updateNutritionCustomFood,
  updateNutritionMeal
} from "../lib/api";
import {
  NutritionCustomFood,
  NutritionDailySummary,
  NutritionMeal,
  NutritionMealItem,
  NutritionTargetProfile,
  NutritionMealType
} from "../types";
import { hapticSuccess } from "../lib/haptics";

interface MealDraft {
  name: string;
}

interface MealItemDraft {
  id: string;
  customFoodId: string;
  amount: string;
}

interface CustomFoodDraft {
  name: string;
  unitLabel: string;
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

interface NutritionDaySnapshotMeal {
  name: string;
  mealType: NutritionMealType;
  items: Array<Omit<NutritionMealItem, "id">>;
  notes?: string;
  consumedTime: string;
}

interface NutritionDaySnapshot {
  id: string;
  name: string;
  createdAt: string;
  meals: NutritionDaySnapshotMeal[];
}

const DAY_SNAPSHOT_STORAGE_KEY = "companion:nutrition-day-snapshots";
const MAX_DAY_SNAPSHOTS = 24;
const MEAL_AMOUNT_STEP = 5;
const MEAL_AMOUNT_HOLD_DELAY_MS = 300;
const MEAL_AMOUNT_HOLD_INTERVAL_MS = 110;

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toTimeHHmm(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "00:00";
  }
  const hh = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  return `${hh}:${min}`;
}

function toIsoForDateTime(dateKey: string, time: string): string {
  const [year, month, day] = dateKey.split("-").map((value) => Number.parseInt(value, 10));
  const [hours, minutes] = time.split(":").map((value) => Number.parseInt(value, 10));

  const parsed = new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    Number.isFinite(month) ? month - 1 : 0,
    Number.isFinite(day) ? day : 1,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  );
  return parsed.toISOString();
}

function loadDaySnapshots(): NutritionDaySnapshot[] {
  try {
    const raw = localStorage.getItem(DAY_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as NutritionDaySnapshot[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((snapshot) => snapshot && typeof snapshot.id === "string" && typeof snapshot.name === "string")
      .slice(0, MAX_DAY_SNAPSHOTS);
  } catch {
    return [];
  }
}

function saveDaySnapshots(snapshots: NutritionDaySnapshot[]): void {
  localStorage.setItem(DAY_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshots.slice(0, MAX_DAY_SNAPSHOTS)));
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

function toMealItemDraft(item?: Partial<MealItemDraft>, fallbackFoodId = ""): MealItemDraft {
  return {
    id: crypto.randomUUID(),
    customFoodId: item?.customFoodId ?? fallbackFoodId,
    amount: item?.amount ?? "100"
  };
}

function parseMealItemDrafts(
  items: MealItemDraft[],
  customFoods: NutritionCustomFood[]
): Array<Omit<NutritionMealItem, "id">> {
  const foodsById = new Map(customFoods.map((food) => [food.id, food]));
  const normalized: Array<Omit<NutritionMealItem, "id">> = [];

  items.forEach((item) => {
    const sourceFood = foodsById.get(item.customFoodId);
    const amount = Number.parseFloat(item.amount);

    if (!sourceFood || !Number.isFinite(amount) || amount <= 0) {
      return;
    }

    normalized.push({
      name: sourceFood.name,
      quantity: roundToTenth(amount),
      unitLabel: sourceFood.unitLabel,
      caloriesPerUnit: sourceFood.caloriesPerUnit,
      proteinGramsPerUnit: sourceFood.proteinGramsPerUnit,
      carbsGramsPerUnit: sourceFood.carbsGramsPerUnit,
      fatGramsPerUnit: sourceFood.fatGramsPerUnit,
      customFoodId: sourceFood.id
    });
  });

  return normalized;
}

function computeMealTotalsFromItems(items: Array<Pick<NutritionMealItem, "quantity" | "caloriesPerUnit" | "proteinGramsPerUnit" | "carbsGramsPerUnit" | "fatGramsPerUnit">>): NutritionDailySummary["totals"] {
  return items.reduce(
    (totals, item) => ({
      calories: totals.calories + item.quantity * item.caloriesPerUnit,
      proteinGrams: roundToTenth(totals.proteinGrams + item.quantity * item.proteinGramsPerUnit),
      carbsGrams: roundToTenth(totals.carbsGrams + item.quantity * item.carbsGramsPerUnit),
      fatGrams: roundToTenth(totals.fatGrams + item.quantity * item.fatGramsPerUnit)
    }),
    {
      calories: 0,
      proteinGrams: 0,
      carbsGrams: 0,
      fatGrams: 0
    }
  );
}

function scaleMealPortion(meal: NutritionMeal, factor: number): NutritionMeal {
  if (meal.items.length > 0) {
    const scaledItems = meal.items.map((item) => ({
      ...item,
      quantity: roundToTenth(item.quantity * factor)
    }));
    const totals = computeMealTotalsFromItems(scaledItems);
    return {
      ...meal,
      items: scaledItems,
      calories: Math.max(0, Math.round(totals.calories)),
      proteinGrams: Math.max(0, totals.proteinGrams),
      carbsGrams: Math.max(0, totals.carbsGrams),
      fatGrams: Math.max(0, totals.fatGrams)
    };
  }

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
    const proteinMin = weightLb * 0.7;
    const proteinMax = weightLb * 1.0;
    const fatMin = weightLb * 0.3;
    const fatMax = weightLb * 0.5;
    const defaultProtein = weightLb * 0.8;
    const defaultFat = weightLb * 0.4;

    const overrideProtein = parseOptionalNumber(draft.targetProteinGrams);
    const overrideFat = parseOptionalNumber(draft.targetFatGrams);
    targetProteinGrams = roundToTenth(clamp(overrideProtein ?? defaultProtein, proteinMin, proteinMax));
    targetFatGrams = roundToTenth(clamp(overrideFat ?? defaultFat, fatMin, fatMax));

    const remainingCalories = Math.max(0, targetCalories - targetProteinGrams * 4 - targetFatGrams * 9);
    targetCarbsGrams = roundToTenth(remainingCalories / 4);
  } else {
    const overrideProtein = parseOptionalNumber(draft.targetProteinGrams);
    const overrideFat = parseOptionalNumber(draft.targetFatGrams);
    if (overrideProtein !== null) targetProteinGrams = roundToTenth(overrideProtein);
    if (overrideFat !== null) targetFatGrams = roundToTenth(overrideFat);
    const overrideCalories = parseOptionalNumber(draft.targetCalories);
    const overrideCarbs = parseOptionalNumber(draft.targetCarbsGrams);
    if (overrideCalories !== null) targetCalories = roundToTenth(overrideCalories);
    if (overrideCarbs !== null) targetCarbsGrams = roundToTenth(overrideCarbs);
  }

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
  const amountHoldTimers = useRef<Record<string, number>>({});
  const amountHoldIntervals = useRef<Record<string, number>>({});
  const [summary, setSummary] = useState<NutritionDailySummary | null>(null);
  const [meals, setMeals] = useState<NutritionMeal[]>([]);
  const [customFoods, setCustomFoods] = useState<NutritionCustomFood[]>([]);
  const [activeTab, setActiveTab] = useState<"meals" | "settings">("meals");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [editingCustomFoodId, setEditingCustomFoodId] = useState<string | null>(null);
  const [targetDraft, setTargetDraft] = useState<NutritionTargetDraft>(() => toTargetDraft(null));
  const [targetDraftDirty, setTargetDraftDirty] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);
  const [daySnapshots, setDaySnapshots] = useState<NutritionDaySnapshot[]>(() => loadDaySnapshots());
  const [daySnapshotName, setDaySnapshotName] = useState("");
  const [selectedDaySnapshotId, setSelectedDaySnapshotId] = useState("");
  const [dayControlBusy, setDayControlBusy] = useState(false);

  const [mealDraft, setMealDraft] = useState<MealDraft>({
    name: ""
  });
  const [mealItemDrafts, setMealItemDrafts] = useState<MealItemDraft[]>([toMealItemDraft()]);

  const [customFoodDraft, setCustomFoodDraft] = useState<CustomFoodDraft>({
    name: "",
    unitLabel: "serving",
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
  const parsedMealItems = useMemo(
    () => parseMealItemDrafts(mealItemDrafts, customFoods),
    [mealItemDrafts, customFoods]
  );
  const draftMealTotals = useMemo(() => computeMealTotalsFromItems(parsedMealItems), [parsedMealItems]);
  const customFoodsById = useMemo(() => new Map(customFoods.map((food) => [food.id, food])), [customFoods]);
  const customFoodDraftCalories = useMemo(() => {
    const protein = Number.parseFloat(customFoodDraft.proteinGramsPerUnit) || 0;
    const carbs = Number.parseFloat(customFoodDraft.carbsGramsPerUnit) || 0;
    const fat = Number.parseFloat(customFoodDraft.fatGramsPerUnit) || 0;
    return roundToTenth(protein * 4 + carbs * 4 + fat * 9);
  }, [customFoodDraft.proteinGramsPerUnit, customFoodDraft.carbsGramsPerUnit, customFoodDraft.fatGramsPerUnit]);
  const macroRanges = useMemo(() => {
    const weightKg = parseOptionalNumber(targetDraft.weightKg);
    if (weightKg === null) {
      return null;
    }
    const weightLb = weightKg * 2.2046226218;
    return {
      proteinMin: roundToTenth(weightLb * 0.7),
      proteinMax: roundToTenth(weightLb * 1.0),
      fatMin: roundToTenth(weightLb * 0.3),
      fatMax: roundToTenth(weightLb * 0.5)
    };
  }, [targetDraft.weightKg]);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    const [nextSummary, nextMeals, nextCustomFoods] = await Promise.all([
      getNutritionSummary(todayKey),
      getNutritionMeals({ date: todayKey }),
      getNutritionCustomFoods({ limit: 200 })
    ]);

    setSummary(nextSummary);
    setMeals(nextMeals);
    setCustomFoods(nextCustomFoods);
    if (!targetDraftDirty) {
      setTargetDraft(toTargetDraft(nextSummary?.targetProfile ?? null));
    }
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (customFoods.length === 0) {
      return;
    }
    const fallbackFoodId = customFoods[0]!.id;
    setMealItemDrafts((previous) =>
      previous.map((item) => (item.customFoodId ? item : { ...item, customFoodId: fallbackFoodId }))
    );
  }, [customFoods]);

  useEffect(() => {
    return () => {
      Object.values(amountHoldTimers.current).forEach((timerId) => window.clearTimeout(timerId));
      Object.values(amountHoldIntervals.current).forEach((intervalId) => window.clearInterval(intervalId));
    };
  }, []);

  const persistDaySnapshots = (nextSnapshots: NutritionDaySnapshot[]): void => {
    saveDaySnapshots(nextSnapshots);
    setDaySnapshots(nextSnapshots);
  };

  const handleSaveDaySnapshot = (): void => {
    const trimmedName = daySnapshotName.trim();
    const fallbackName = `Day ${new Date().toLocaleDateString("en-GB")}`;
    const snapshotName = trimmedName || fallbackName;
    const nowIso = new Date().toISOString();

    const nextSnapshot: NutritionDaySnapshot = {
      id: selectedDaySnapshotId || crypto.randomUUID(),
      name: snapshotName,
      createdAt: nowIso,
      meals: meals.map((meal) => ({
        name: meal.name,
        mealType: meal.mealType,
        items: meal.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitLabel: item.unitLabel,
          caloriesPerUnit: item.caloriesPerUnit,
          proteinGramsPerUnit: item.proteinGramsPerUnit,
          carbsGramsPerUnit: item.carbsGramsPerUnit,
          fatGramsPerUnit: item.fatGramsPerUnit,
          ...(item.customFoodId ? { customFoodId: item.customFoodId } : {})
        })),
        consumedTime: toTimeHHmm(meal.consumedAt)
      }))
    };

    const nextSnapshots = [nextSnapshot, ...daySnapshots.filter((snapshot) => snapshot.id !== nextSnapshot.id)].slice(
      0,
      MAX_DAY_SNAPSHOTS
    );
    persistDaySnapshots(nextSnapshots);
    setSelectedDaySnapshotId(nextSnapshot.id);
    setDaySnapshotName("");
    setMessage(`Saved day snapshot "${snapshotName}".`);
    hapticSuccess();
  };

  const clearCurrentDayData = async (): Promise<boolean> => {
    const deletedMeals = await Promise.all(meals.map((meal) => deleteNutritionMeal(meal.id)));
    return deletedMeals.every(Boolean);
  };

  const handleLoadDaySnapshot = async (): Promise<void> => {
    const snapshot = daySnapshots.find((candidate) => candidate.id === selectedDaySnapshotId);
    if (!snapshot) {
      setMessage("Choose a saved day snapshot first.");
      return;
    }

    setDayControlBusy(true);
    setMessage("");

    const resetOk = await clearCurrentDayData();
    if (!resetOk) {
      setDayControlBusy(false);
      setMessage("Could not clear today's meals before loading snapshot.");
      return;
    }

    let allCreated = true;
    for (const meal of snapshot.meals) {
      const created = await createNutritionMeal({
        name: meal.name,
        mealType: meal.mealType,
        consumedAt: toIsoForDateTime(todayKey, meal.consumedTime),
        items: Array.isArray(meal.items) ? meal.items : []
      });
      if (!created) {
        allCreated = false;
      }
    }

    await refresh();
    setDayControlBusy(false);
    hapticSuccess();
    setMessage(
      allCreated
        ? `Loaded day snapshot "${snapshot.name}".`
        : `Loaded "${snapshot.name}" with partial errors. Try Refresh and repeat if needed.`
    );
  };

  const handleResetDay = async (): Promise<void> => {
    if (!window.confirm("Clear all meals for today?")) {
      return;
    }

    setDayControlBusy(true);
    setMessage("");
    const ok = await clearCurrentDayData();
    await refresh();
    setDayControlBusy(false);

    if (!ok) {
      setMessage("Could not fully reset day right now.");
      return;
    }
    hapticSuccess();
    setMessage("Reset today's nutrition plan.");
  };

  const handleDeleteDaySnapshot = (): void => {
    if (!selectedDaySnapshotId) {
      return;
    }
    const next = daySnapshots.filter((snapshot) => snapshot.id !== selectedDaySnapshotId);
    persistDaySnapshots(next);
    setSelectedDaySnapshotId("");
    setMessage("Deleted selected day snapshot.");
  };

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

    const derived = deriveTargetsFromDraft(targetDraft);
    const saved = await upsertNutritionTargetProfile({
      date: todayKey,
      weightKg: parseOptionalNumber(targetDraft.weightKg),
      maintenanceCalories: parseOptionalNumber(targetDraft.maintenanceCalories),
      surplusCalories: parseOptionalNumber(targetDraft.surplusCalories),
      targetCalories: derived ? derived.targetCalories : parseOptionalNumber(targetDraft.targetCalories),
      targetProteinGrams: derived ? derived.targetProteinGrams : parseOptionalNumber(targetDraft.targetProteinGrams),
      targetCarbsGrams: derived ? derived.targetCarbsGrams : parseOptionalNumber(targetDraft.targetCarbsGrams),
      targetFatGrams: derived ? derived.targetFatGrams : parseOptionalNumber(targetDraft.targetFatGrams)
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

    if (!mealDraft.name.trim()) {
      setMessage("Enter a meal name.");
      return;
    }
    if (parsedMealItems.length === 0) {
      setMessage("Add at least one valid food item with an amount.");
      return;
    }

    const created = await createNutritionMeal({
      name: mealDraft.name.trim(),
      items: parsedMealItems
    });

    if (!created) {
      setMessage("Could not log meal right now.");
      return;
    }

    hapticSuccess();
    setMealDraft({
      name: ""
    });
    setMealItemDrafts([toMealItemDraft(undefined, customFoods[0]?.id ?? "")]);
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
      ...(scaled.items.length > 0
        ? {
            items: scaled.items.map(({ id, ...item }) => item)
          }
        : {
            calories: scaled.calories,
            proteinGrams: scaled.proteinGrams,
            carbsGrams: scaled.carbsGrams,
            fatGrams: scaled.fatGrams
          })
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

  const updateMealItemAmount = (id: string, delta: number): void => {
    setMealItemDrafts((previous) =>
      previous.map((item) => {
        if (item.id !== id) {
          return item;
        }
        const current = Number.parseFloat(item.amount);
        const next = Math.max(1, roundToTenth((Number.isFinite(current) ? current : 0) + delta));
        return {
          ...item,
          amount: String(next)
        };
      })
    );
  };

  const stopAmountHold = (id: string): void => {
    const timeoutId = amountHoldTimers.current[id];
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      delete amountHoldTimers.current[id];
    }

    const intervalId = amountHoldIntervals.current[id];
    if (intervalId !== undefined) {
      window.clearInterval(intervalId);
      delete amountHoldIntervals.current[id];
    }
  };

  const startAmountHold = (id: string, delta: number): void => {
    stopAmountHold(id);
    updateMealItemAmount(id, delta);
    amountHoldTimers.current[id] = window.setTimeout(() => {
      amountHoldIntervals.current[id] = window.setInterval(() => {
        updateMealItemAmount(id, delta);
      }, MEAL_AMOUNT_HOLD_INTERVAL_MS);
    }, MEAL_AMOUNT_HOLD_DELAY_MS);
  };

  const handleAddMealItemDraft = (): void => {
    setMealItemDrafts((previous) => [...previous, toMealItemDraft(undefined, customFoods[0]?.id ?? "")]);
  };

  const handleUpdateMealItemDraft = (id: string, patch: Partial<Omit<MealItemDraft, "id">>): void => {
    setMealItemDrafts((previous) =>
      previous.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch
            }
          : item
      )
    );
  };

  const handleDeleteMealItemDraft = (id: string): void => {
    stopAmountHold(id);
    setMealItemDrafts((previous) => {
      const next = previous.filter((item) => item.id !== id);
      return next.length > 0 ? next : [toMealItemDraft(undefined, customFoods[0]?.id ?? "")];
    });
  };

  const resetCustomFoodDraft = (): void => {
    setEditingCustomFoodId(null);
    setCustomFoodDraft({
      name: "",
      unitLabel: "serving",
      proteinGramsPerUnit: "",
      carbsGramsPerUnit: "",
      fatGramsPerUnit: ""
    });
  };

  const handleCustomFoodSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setMessage("");

    const name = customFoodDraft.name.trim();
    if (!name) {
      setMessage("Enter a valid custom food name.");
      return;
    }

    const proteinGramsPerUnit = Math.max(0, Number.parseFloat(customFoodDraft.proteinGramsPerUnit) || 0);
    const carbsGramsPerUnit = Math.max(0, Number.parseFloat(customFoodDraft.carbsGramsPerUnit) || 0);
    const fatGramsPerUnit = Math.max(0, Number.parseFloat(customFoodDraft.fatGramsPerUnit) || 0);
    const caloriesPerUnit = roundToTenth(proteinGramsPerUnit * 4 + carbsGramsPerUnit * 4 + fatGramsPerUnit * 9);

    const payload = {
      name,
      unitLabel: customFoodDraft.unitLabel.trim() || "serving",
      caloriesPerUnit,
      proteinGramsPerUnit,
      carbsGramsPerUnit,
      fatGramsPerUnit
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

  return (
    <section className="nutrition-view">
      <header className="nutrition-header">
        <div>
          <p className="eyebrow">Nutrition</p>
          <h2>Macros</h2>
        </div>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      <div className="nutrition-tab-switcher" role="tablist" aria-label="Nutrition sections">
        <button
          type="button"
          className={activeTab === "meals" ? "nutrition-tab-switcher-active" : ""}
          onClick={() => setActiveTab("meals")}
          aria-pressed={activeTab === "meals"}
        >
          Meals
        </button>
        <button
          type="button"
          className={activeTab === "settings" ? "nutrition-tab-switcher-active" : ""}
          onClick={() => setActiveTab("settings")}
          aria-pressed={activeTab === "settings"}
        >
          Settings
        </button>
      </div>

      {message && <p className="nutrition-message">{message}</p>}

      {activeTab === "settings" && (
        <>
          <article className="nutrition-card nutrition-day-controls">
            <div className="nutrition-day-controls-header">
              <h3>Day controls</h3>
              <p className="nutrition-item-meta">Save, load, or reset today&apos;s macro plan in one tap.</p>
            </div>
            <div className="nutrition-day-controls-grid">
              <label>
                Snapshot name
                <input
                  type="text"
                  value={daySnapshotName}
                  onChange={(event) => setDaySnapshotName(event.target.value)}
                  maxLength={80}
                  placeholder="e.g. Lean bulk weekday"
                />
              </label>
              <button type="button" onClick={handleSaveDaySnapshot} disabled={dayControlBusy || loading}>
                Save day
              </button>
              <label>
                Saved snapshots
                <select
                  value={selectedDaySnapshotId}
                  onChange={(event) => setSelectedDaySnapshotId(event.target.value)}
                  disabled={dayControlBusy}
                >
                  <option value="">Select snapshot</option>
                  {daySnapshots.map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>
                      {snapshot.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="nutrition-inline-actions">
                <button
                  type="button"
                  onClick={() => void handleLoadDaySnapshot()}
                  disabled={dayControlBusy || !selectedDaySnapshotId}
                >
                  Load day
                </button>
                <button
                  type="button"
                  className="nutrition-secondary-button"
                  onClick={() => void handleResetDay()}
                  disabled={dayControlBusy || loading}
                >
                  Reset day
                </button>
                <button
                  type="button"
                  className="nutrition-secondary-button"
                  onClick={handleDeleteDaySnapshot}
                  disabled={dayControlBusy || !selectedDaySnapshotId}
                >
                  Delete saved
                </button>
              </div>
            </div>
          </article>

          <article className="nutrition-card">
            <div>
              <h3>Plan settings</h3>
              <p className="nutrition-item-meta">
                Set weight, maintenance, and surplus to derive targets. Protein/fat stay in recommended ranges and
                carbs are auto-filled from remaining calories.
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
                  Protein target (optional)
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={targetDraft.targetProteinGrams}
                    onChange={(event) => updateTargetDraftField("targetProteinGrams", event.target.value)}
                  />
                  {macroRanges && (
                    <small>
                      Recommended: {formatMetric(macroRanges.proteinMin)}-{formatMetric(macroRanges.proteinMax)} g
                    </small>
                  )}
                </label>
                <label>
                  Fat target (optional)
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={targetDraft.targetFatGrams}
                    onChange={(event) => updateTargetDraftField("targetFatGrams", event.target.value)}
                  />
                  {macroRanges && (
                    <small>
                      Recommended: {formatMetric(macroRanges.fatMin)}-{formatMetric(macroRanges.fatMax)} g
                    </small>
                  )}
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
        </>
      )}

      {activeTab === "meals" && (
        <>
          <article className="nutrition-card">
            <h3>Meals</h3>
            {meals.length === 0 ? (
              <p>No meals logged yet.</p>
            ) : (
              <div className="nutrition-list">
                {meals.map((meal) => (
                  <article key={meal.id} className="nutrition-list-item">
                    <div>
                      <p className="nutrition-item-title">{meal.name}</p>
                      <p className="nutrition-item-meta">
                        {meal.calories} kcal • {meal.proteinGrams}P/{meal.carbsGrams}C/{meal.fatGrams}F •{" "}
                        {formatDateTime(meal.consumedAt)}
                      </p>
                      {meal.items.length > 0 && (
                        <ul className="nutrition-meal-item-list">
                          {meal.items.map((item) => {
                            const itemCalories = Math.round(item.quantity * item.caloriesPerUnit);
                            const itemProtein = roundToTenth(item.quantity * item.proteinGramsPerUnit);
                            const itemCarbs = roundToTenth(item.quantity * item.carbsGramsPerUnit);
                            const itemFat = roundToTenth(item.quantity * item.fatGramsPerUnit);
                            return (
                              <li key={item.id}>
                                {item.name} • {formatMetric(item.quantity)} {item.unitLabel} • {itemCalories} kcal •{" "}
                                {itemProtein}P/{itemCarbs}C/{itemFat}F
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div className="nutrition-list-item-actions nutrition-quick-controls">
                      <button
                        type="button"
                        onClick={() => void handleAdjustMealPortion(meal.id, "down")}
                        aria-label="Decrease portion"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAdjustMealPortion(meal.id, "up")}
                        aria-label="Increase portion"
                      >
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
            {customFoods.length === 0 && (
              <p className="nutrition-item-meta">Create at least one custom food first, then log meals from the dropdown.</p>
            )}
            <form className="nutrition-form" onSubmit={(event) => void handleMealSubmit(event)}>
              <div className="nutrition-form-row">
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
              </div>

              <div className="nutrition-item-editor-list">
                {mealItemDrafts.map((item) => {
                  const selectedFood = customFoodsById.get(item.customFoodId);
                  return (
                    <article key={item.id} className="nutrition-item-editor">
                      <div className="nutrition-form-row">
                        <label>
                          Food
                          <select
                            value={item.customFoodId}
                            onChange={(event) =>
                              handleUpdateMealItemDraft(item.id, {
                                customFoodId: event.target.value
                              })
                            }
                          >
                            <option value="">Select custom food</option>
                            {customFoods.map((food) => (
                              <option key={food.id} value={food.id}>
                                {food.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Amount ({selectedFood?.unitLabel ?? "unit"})
                          <div className="nutrition-amount-control">
                            <button
                              type="button"
                              className="nutrition-amount-button"
                              onPointerDown={(event) => {
                                event.preventDefault();
                                startAmountHold(item.id, -MEAL_AMOUNT_STEP);
                              }}
                              onPointerUp={() => stopAmountHold(item.id)}
                              onPointerLeave={() => stopAmountHold(item.id)}
                              onPointerCancel={() => stopAmountHold(item.id)}
                              aria-label="Decrease amount"
                            >
                              -
                            </button>
                            <input
                              className="nutrition-amount-input"
                              type="number"
                              min={1}
                              step={1}
                              value={item.amount}
                              onChange={(event) => handleUpdateMealItemDraft(item.id, { amount: event.target.value })}
                            />
                            <button
                              type="button"
                              className="nutrition-amount-button"
                              onPointerDown={(event) => {
                                event.preventDefault();
                                startAmountHold(item.id, MEAL_AMOUNT_STEP);
                              }}
                              onPointerUp={() => stopAmountHold(item.id)}
                              onPointerLeave={() => stopAmountHold(item.id)}
                              onPointerCancel={() => stopAmountHold(item.id)}
                              aria-label="Increase amount"
                            >
                              +
                            </button>
                          </div>
                        </label>
                      </div>
                      {selectedFood && (
                        <p className="nutrition-item-meta">
                          Auto: {selectedFood.caloriesPerUnit} kcal/{selectedFood.unitLabel} •{" "}
                          {selectedFood.proteinGramsPerUnit}P/{selectedFood.carbsGramsPerUnit}C/
                          {selectedFood.fatGramsPerUnit}F
                        </p>
                      )}
                      <div className="nutrition-inline-actions">
                        <button
                          type="button"
                          className="nutrition-secondary-button"
                          onClick={() => handleDeleteMealItemDraft(item.id)}
                        >
                          Remove item
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="nutrition-inline-actions">
                <button type="button" className="nutrition-secondary-button" onClick={handleAddMealItemDraft}>
                  Add food item
                </button>
              </div>

              <p className="nutrition-item-meta">
                Draft totals: {Math.round(draftMealTotals.calories)} kcal • {formatMetric(draftMealTotals.proteinGrams)}
                P/{formatMetric(draftMealTotals.carbsGrams)}C/{formatMetric(draftMealTotals.fatGrams)}F
              </p>
              <button type="submit" disabled={customFoods.length === 0}>
                Log meal
              </button>
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
              <p className="nutrition-item-meta">
                Calories / unit (auto): {formatMetric(customFoodDraftCalories)} kcal
              </p>
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
        </>
      )}
    </section>
  );
}
