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
  proteinGramsPerLb: string;
  fatGramsPerLb: string;
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
const MEAL_AMOUNT_STEP = 1;
const MEAL_AMOUNT_HOLD_DELAY_MS = 300;
const MEAL_AMOUNT_HOLD_INTERVAL_MS = 110;
const KG_TO_LB = 2.2046226218;
const MEAL_DONE_TOKEN = "[done]";

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

function roundToPrecision(value: number, precision = 1): number {
  const decimals = Number.isInteger(precision) ? Math.min(Math.max(precision, 0), 6) : 1;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundToTenth(value: number): number {
  return roundToPrecision(value, 1);
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
      unitLabel: "g",
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
      proteinGramsPerLb: "0.8",
      fatGramsPerLb: "0.4"
    };
  }

  const weightKg = typeof profile.weightKg === "number" ? profile.weightKg : null;
  const weightLb = weightKg && weightKg > 0 ? weightKg * KG_TO_LB : null;
  const proteinPerLb =
    weightLb && typeof profile.targetProteinGrams === "number" ? roundToTenth(profile.targetProteinGrams / weightLb) : 0.8;
  const fatPerLb =
    weightLb && typeof profile.targetFatGrams === "number" ? roundToTenth(profile.targetFatGrams / weightLb) : 0.4;

  return {
    weightKg: toNumberString(profile.weightKg),
    maintenanceCalories: toNumberString(profile.maintenanceCalories),
    surplusCalories: toNumberString(profile.surplusCalories),
    proteinGramsPerLb: toNumberString(proteinPerLb),
    fatGramsPerLb: toNumberString(fatPerLb)
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
  proteinGramsPerLb: number;
  carbsGramsPerLb: number;
  fatGramsPerLb: number;
} | null {
  const weightKg = parseOptionalNumber(draft.weightKg);
  const maintenanceCalories = parseOptionalNumber(draft.maintenanceCalories);
  const surplusCalories = parseOptionalNumber(draft.surplusCalories);

  if (weightKg === null || maintenanceCalories === null || surplusCalories === null || weightKg <= 0) {
    return null;
  }

  const weightLb = weightKg * KG_TO_LB;
  const proteinPerLb = clamp(parseOptionalNumber(draft.proteinGramsPerLb) ?? 0.8, 0.7, 1.0);
  const fatPerLb = clamp(parseOptionalNumber(draft.fatGramsPerLb) ?? 0.4, 0.3, 0.5);
  const targetCalories = roundToTenth(maintenanceCalories + surplusCalories);
  const targetProteinGrams = roundToTenth(weightLb * proteinPerLb);
  const targetFatGrams = roundToTenth(weightLb * fatPerLb);
  const remainingCalories = Math.max(0, targetCalories - targetProteinGrams * 4 - targetFatGrams * 9);
  const targetCarbsGrams = roundToTenth(remainingCalories / 4);
  const carbsPerLb = roundToTenth(targetCarbsGrams / weightLb);

  return {
    targetCalories,
    targetProteinGrams,
    targetCarbsGrams,
    targetFatGrams,
    proteinGramsPerLb: roundToTenth(proteinPerLb),
    carbsGramsPerLb: carbsPerLb,
    fatGramsPerLb: roundToTenth(fatPerLb)
  };
}

function completeTargetsFromProfile(profile: NutritionTargetProfile | null): {
  targetCalories: number;
  targetProteinGrams: number;
  targetCarbsGrams: number;
  targetFatGrams: number;
  proteinGramsPerLb: number | null;
  carbsGramsPerLb: number | null;
  fatGramsPerLb: number | null;
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

  const weightKg = typeof profile.weightKg === "number" ? profile.weightKg : null;
  const weightLb = weightKg && weightKg > 0 ? weightKg * KG_TO_LB : null;
  const proteinPerLb =
    weightLb !== null ? roundToTenth(profile.targetProteinGrams / weightLb) : null;
  const carbsPerLb =
    weightLb !== null ? roundToTenth(profile.targetCarbsGrams / weightLb) : null;
  const fatPerLb =
    weightLb !== null ? roundToTenth(profile.targetFatGrams / weightLb) : null;

  return {
    targetCalories: roundToTenth(profile.targetCalories),
    targetProteinGrams: roundToTenth(profile.targetProteinGrams),
    targetCarbsGrams: roundToTenth(profile.targetCarbsGrams),
    targetFatGrams: roundToTenth(profile.targetFatGrams),
    proteinGramsPerLb: proteinPerLb,
    carbsGramsPerLb: carbsPerLb,
    fatGramsPerLb: fatPerLb
  };
}

function formatMetric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPerUnitMetric(value: number): string {
  const rounded = roundToPrecision(value, 3);
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(3).replace(/\.?0+$/, "");
}

function formatSignedDelta(value: number, unit: string): string {
  const rounded = roundToTenth(value);
  if (Math.abs(rounded) < 0.1) {
    return "On target";
  }

  return `${rounded > 0 ? "+" : ""}${formatMetric(rounded)}${unit}`;
}

function calculateCaloriesFromMacros(proteinGrams: number, carbsGrams: number, fatGrams: number): number {
  return proteinGrams * 4 + carbsGrams * 4 + fatGrams * 9;
}

function mealDisplayCalories(meal: Pick<NutritionMeal, "calories" | "proteinGrams" | "carbsGrams" | "fatGrams">): number {
  const hasMacroSignal = meal.proteinGrams > 0 || meal.carbsGrams > 0 || meal.fatGrams > 0;
  if (!hasMacroSignal) {
    return roundToTenth(meal.calories);
  }
  return roundToTenth(calculateCaloriesFromMacros(meal.proteinGrams, meal.carbsGrams, meal.fatGrams));
}

type DeltaMetric = "proteinGrams" | "carbsGrams" | "fatGrams" | "calories";

function deltaToneClass(metric: DeltaMetric, value: number): string {
  const rounded = roundToTenth(value);
  const absoluteDelta = Math.abs(rounded);
  const closeThresholdByMetric: Record<DeltaMetric, number> = {
    proteinGrams: 5,
    carbsGrams: 10,
    fatGrams: 5,
    calories: 50
  };

  if (absoluteDelta <= closeThresholdByMetric[metric]) {
    return "nutrition-delta-positive";
  }
  return "nutrition-delta-warning";
}

function stripMealItemId(item: NutritionMealItem): Omit<NutritionMealItem, "id"> {
  return {
    name: item.name,
    quantity: item.quantity,
    unitLabel: item.unitLabel,
    caloriesPerUnit: item.caloriesPerUnit,
    proteinGramsPerUnit: item.proteinGramsPerUnit,
    carbsGramsPerUnit: item.carbsGramsPerUnit,
    fatGramsPerUnit: item.fatGramsPerUnit,
    ...(item.customFoodId ? { customFoodId: item.customFoodId } : {})
  };
}

function mealNotesWithDone(notes: string | undefined, completed: boolean): string | undefined {
  const cleaned = (notes ?? "")
    .replaceAll(MEAL_DONE_TOKEN, "")
    .trim();
  if (completed) {
    return cleaned.length > 0 ? `${MEAL_DONE_TOKEN} ${cleaned}` : MEAL_DONE_TOKEN;
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

function isMealCompleted(meal: NutritionMeal): boolean {
  return typeof meal.notes === "string" && meal.notes.includes(MEAL_DONE_TOKEN);
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
  const [showDayControlPanel, setShowDayControlPanel] = useState(false);
  const [showLogMealPanel, setShowLogMealPanel] = useState(false);
  const [showCustomFoodsPanel, setShowCustomFoodsPanel] = useState(false);
  const [mealFoodPickerByMeal, setMealFoodPickerByMeal] = useState<Record<string, string>>({});

  const [mealDraft, setMealDraft] = useState<MealDraft>({
    name: ""
  });
  const [mealItemDrafts, setMealItemDrafts] = useState<MealItemDraft[]>([toMealItemDraft()]);

  const [customFoodDraft, setCustomFoodDraft] = useState<CustomFoodDraft>({
    name: "",
    unitLabel: "g",
    proteinGramsPerUnit: "",
    carbsGramsPerUnit: "",
    fatGramsPerUnit: ""
  });

  const derivedTargets = useMemo(() => deriveTargetsFromDraft(targetDraft), [targetDraft]);
  const activeTargets = useMemo(
    () => derivedTargets ?? completeTargetsFromProfile(summary?.targetProfile ?? null),
    [derivedTargets, summary?.targetProfile]
  );
  const dailyDisplayCalories = useMemo(() => {
    if (!summary) {
      return 0;
    }
    if (summary.meals.length > 0) {
      return roundToTenth(summary.meals.reduce((total, meal) => total + mealDisplayCalories(meal), 0));
    }
    const hasMacroSignal = summary.totals.proteinGrams > 0 || summary.totals.carbsGrams > 0 || summary.totals.fatGrams > 0;
    if (!hasMacroSignal) {
      return roundToTenth(summary.totals.calories);
    }
    return roundToTenth(
      calculateCaloriesFromMacros(summary.totals.proteinGrams, summary.totals.carbsGrams, summary.totals.fatGrams)
    );
  }, [summary]);
  const intakeDeltas = useMemo(() => {
    if (!summary || !activeTargets) {
      return null;
    }

    return {
      calories: roundToTenth(dailyDisplayCalories - activeTargets.targetCalories),
      proteinGrams: roundToTenth(summary.totals.proteinGrams - activeTargets.targetProteinGrams),
      carbsGrams: roundToTenth(summary.totals.carbsGrams - activeTargets.targetCarbsGrams),
      fatGrams: roundToTenth(summary.totals.fatGrams - activeTargets.targetFatGrams)
    };
  }, [summary, activeTargets, dailyDisplayCalories]);
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
    const weightLb = weightKg * KG_TO_LB;
    return {
      proteinPerLbMin: 0.7,
      proteinPerLbMax: 1.0,
      fatPerLbMin: 0.3,
      fatPerLbMax: 0.5,
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
    setMealFoodPickerByMeal((previous) => {
      const next: Record<string, string> = { ...previous };
      meals.forEach((meal) => {
        if (!next[meal.id]) {
          next[meal.id] = fallbackFoodId;
        }
      });
      return next;
    });
  }, [customFoods, meals]);

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
    if (!derived) {
      setSavingTargets(false);
      setMessage("Set weight, maintenance, and surplus to save targets.");
      return;
    }

    const saved = await upsertNutritionTargetProfile({
      date: todayKey,
      weightKg: parseOptionalNumber(targetDraft.weightKg),
      maintenanceCalories: parseOptionalNumber(targetDraft.maintenanceCalories),
      surplusCalories: parseOptionalNumber(targetDraft.surplusCalories),
      targetCalories: derived.targetCalories,
      targetProteinGrams: derived.targetProteinGrams,
      targetCarbsGrams: derived.targetCarbsGrams,
      targetFatGrams: derived.targetFatGrams
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
    setMealFoodPickerByMeal((previous) => {
      const next = { ...previous };
      delete next[mealId];
      return next;
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

  const replaceMealInState = (updatedMeal: NutritionMeal): void => {
    setMeals((previous) => {
      const nextMeals = previous.map((meal) => (meal.id === updatedMeal.id ? updatedMeal : meal));
      setSummary((current) => withMealsSummary(current, nextMeals));
      return nextMeals;
    });
  };

  const handleToggleMealCompleted = async (mealId: string): Promise<void> => {
    const currentMeal = meals.find((meal) => meal.id === mealId);
    if (!currentMeal) {
      return;
    }

    const nextCompleted = !isMealCompleted(currentMeal);
    const nextNotes = mealNotesWithDone(currentMeal.notes, nextCompleted);
    const updated = await updateNutritionMeal(mealId, { notes: nextNotes ?? "" });
    if (!updated) {
      setMessage("Could not update meal completion right now.");
      return;
    }

    hapticSuccess();
    replaceMealInState(updated);
  };

  const handleAdjustMealItemQuantity = async (mealId: string, itemIndex: number, delta: number): Promise<void> => {
    const currentMeal = meals.find((meal) => meal.id === mealId);
    if (!currentMeal) {
      return;
    }
    const target = currentMeal.items[itemIndex];
    if (!target) {
      return;
    }

    const current = Number.isFinite(target.quantity) ? target.quantity : 0;
    const nextQuantity = Math.max(1, roundToTenth(current + delta));
    const nextItems = currentMeal.items.map((item, index) =>
      index === itemIndex
        ? {
            ...item,
            quantity: nextQuantity
          }
        : item
    );

    const updated = await updateNutritionMeal(mealId, {
      items: nextItems.map(stripMealItemId)
    });
    if (!updated) {
      setMessage("Could not adjust food amount right now.");
      return;
    }

    hapticSuccess();
    replaceMealInState(updated);
  };

  const handleRemoveMealItem = async (mealId: string, itemIndex: number): Promise<void> => {
    const currentMeal = meals.find((meal) => meal.id === mealId);
    if (!currentMeal) {
      return;
    }

    const nextItems = currentMeal.items.filter((_, index) => index !== itemIndex);
    const updated = await updateNutritionMeal(mealId, {
      items: nextItems.map(stripMealItemId),
      ...(nextItems.length === 0
        ? {
            calories: 0,
            proteinGrams: 0,
            carbsGrams: 0,
            fatGrams: 0
          }
        : {})
    });
    if (!updated) {
      setMessage("Could not remove food item right now.");
      return;
    }

    hapticSuccess();
    replaceMealInState(updated);
  };

  const handleMealFoodPickerChange = (mealId: string, customFoodId: string): void => {
    setMealFoodPickerByMeal((previous) => ({
      ...previous,
      [mealId]: customFoodId
    }));
  };

  const handleAddFoodToMeal = async (mealId: string): Promise<void> => {
    const currentMeal = meals.find((meal) => meal.id === mealId);
    if (!currentMeal) {
      return;
    }

    const selectedFoodId = mealFoodPickerByMeal[mealId] ?? customFoods[0]?.id ?? "";
    const selectedFood = customFoodsById.get(selectedFoodId);
    if (!selectedFood) {
      setMessage("Select a custom food first.");
      return;
    }

    const nextItems: NutritionMealItem[] = [
      ...currentMeal.items,
      {
        name: selectedFood.name,
        quantity: 100,
        unitLabel: "g",
        caloriesPerUnit: selectedFood.caloriesPerUnit,
        proteinGramsPerUnit: selectedFood.proteinGramsPerUnit,
        carbsGramsPerUnit: selectedFood.carbsGramsPerUnit,
        fatGramsPerUnit: selectedFood.fatGramsPerUnit,
        customFoodId: selectedFood.id
      }
    ];

    const updated = await updateNutritionMeal(mealId, {
      items: nextItems.map(stripMealItemId)
    });
    if (!updated) {
      setMessage("Could not add food item right now.");
      return;
    }

    hapticSuccess();
    replaceMealInState(updated);
  };

  const handleMoveMeal = async (mealId: string, direction: "up" | "down"): Promise<void> => {
    const currentOrder = [...meals];
    const index = currentOrder.findIndex((meal) => meal.id === mealId);
    if (index === -1) {
      return;
    }
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= currentOrder.length) {
      return;
    }

    const reordered = [...currentOrder];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved!);

    const dayStart = new Date(`${todayKey}T00:00:00.000Z`).getTime();
    const patchPlan = reordered.map((meal, orderIndex) => ({
      mealId: meal.id,
      consumedAt: new Date(dayStart + orderIndex * 60_000).toISOString()
    }));

    const updatedMeals: NutritionMeal[] = [];
    for (const patch of patchPlan) {
      const updated = await updateNutritionMeal(patch.mealId, { consumedAt: patch.consumedAt });
      if (!updated) {
        setMessage("Could not reorder meals right now.");
        return;
      }
      updatedMeals.push(updated);
    }

    const updatedById = new Map(updatedMeals.map((meal) => [meal.id, meal]));
    const nextMeals = reordered.map((meal) => updatedById.get(meal.id) ?? meal);
    hapticSuccess();
    setMeals(nextMeals);
    setSummary((current) => withMealsSummary(current, nextMeals));
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
    setMealItemDrafts((previous) => previous.filter((item) => item.id !== id));
  };

  const handleQuickAddCustomFood = (foodId: string): void => {
    if (!foodId) {
      return;
    }

    const nextItem = toMealItemDraft(
      {
        customFoodId: foodId,
        amount: "100"
      },
      customFoods[0]?.id ?? ""
    );

    setMealItemDrafts((previous) => {
      const singleBlank =
        previous.length === 1 &&
        (!previous[0]?.customFoodId || !customFoodsById.has(previous[0].customFoodId));
      return singleBlank ? [nextItem] : [...previous, nextItem];
    });
  };

  const resetCustomFoodDraft = (): void => {
    setEditingCustomFoodId(null);
    setCustomFoodDraft({
      name: "",
      unitLabel: "g",
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
    const caloriesPerUnit = roundToPrecision(proteinGramsPerUnit * 4 + carbsGramsPerUnit * 4 + fatGramsPerUnit * 9, 3);

    const payload = {
      name,
      unitLabel: "g",
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
      unitLabel: "g",
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

      {activeTab === "meals" && (
        <>
          <article className="nutrition-card nutrition-plan-hero">
            <div className="nutrition-plan-hero-main">
              <h3>Bulking Meal Plan</h3>
              <p className="nutrition-plan-hero-badge">Temporary Changes (Today)</p>
            </div>
            <div className="nutrition-plan-hero-actions">
              <button
                type="button"
                className="nutrition-secondary-button"
                onClick={() => void handleResetDay()}
                disabled={dayControlBusy || loading}
              >
                Reset Day
              </button>
              <button
                type="button"
                onClick={() => setShowDayControlPanel((current) => !current)}
                disabled={dayControlBusy}
              >
                {showDayControlPanel ? "Hide Options" : "Save Options"}
              </button>
              <button
                type="button"
                className="nutrition-secondary-button"
                onClick={() => void handleLoadDaySnapshot()}
                disabled={dayControlBusy || !selectedDaySnapshotId}
              >
                Load ({daySnapshots.length})
              </button>
            </div>
          </article>

          {showDayControlPanel && (
            <article className="nutrition-card nutrition-day-controls">
              <div className="nutrition-day-controls-header">
                <h3>Day controls</h3>
                <p className="nutrition-item-meta">Save or load complete day snapshots without using extra space.</p>
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
                  <button type="button" onClick={handleSaveDaySnapshot} disabled={dayControlBusy || loading}>
                    Save day
                  </button>
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
                    onClick={handleDeleteDaySnapshot}
                    disabled={dayControlBusy || !selectedDaySnapshotId}
                  >
                    Delete saved
                  </button>
                </div>
              </div>
            </article>
          )}

          <article className="nutrition-card">
            <div>
              <h3>Target macros</h3>
            </div>

            <div className="nutrition-summary-grid nutrition-target-dashboard">
              <article className="summary-tile nutrition-target-card nutrition-target-card-protein">
                <p className="summary-label">Target protein</p>
                <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetProteinGrams)}g` : "—"}</p>
                <p className="nutrition-item-meta">
                  {activeTargets && activeTargets.proteinGramsPerLb !== null
                    ? `${formatMetric(activeTargets.proteinGramsPerLb)} g/lb`
                    : "—"}
                </p>
              </article>
              <article className="summary-tile nutrition-target-card nutrition-target-card-carbs">
                <p className="summary-label">Target carbs</p>
                <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetCarbsGrams)}g` : "—"}</p>
                <p className="nutrition-item-meta">
                  {activeTargets && activeTargets.carbsGramsPerLb !== null
                    ? `${formatMetric(activeTargets.carbsGramsPerLb)} g/lb`
                    : "—"}
                </p>
              </article>
              <article className="summary-tile nutrition-target-card nutrition-target-card-fat">
                <p className="summary-label">Target fat</p>
                <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetFatGrams)}g` : "—"}</p>
                <p className="nutrition-item-meta">
                  {activeTargets && activeTargets.fatGramsPerLb !== null
                    ? `${formatMetric(activeTargets.fatGramsPerLb)} g/lb`
                    : "—"}
                </p>
              </article>
              <article className="summary-tile nutrition-target-card nutrition-target-card-calories">
                <p className="summary-label">Target calories</p>
                <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetCalories)} kcal` : "—"}</p>
              </article>
            </div>
          </article>

          <article className="nutrition-card nutrition-meal-tools-card">
            <div className="nutrition-meal-tools-header">
              <h3>Meal tools</h3>
              <p className="nutrition-item-meta">Log meals and manage custom foods in one place.</p>
            </div>

            <section className="nutrition-tool-panel">
              <div className="nutrition-custom-food-header">
                <h4>Log meal</h4>
                <button type="button" onClick={() => setShowLogMealPanel((current) => !current)}>
                  {showLogMealPanel ? "Hide" : "Expand"}
                </button>
              </div>
              {showLogMealPanel && (
                <>
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

                    {customFoods.length > 0 && (
                      <div className="nutrition-quick-food-grid" aria-label="Quick add custom foods">
                        {customFoods.map((food) => (
                          <button
                            key={food.id}
                            type="button"
                            className="nutrition-quick-food-chip"
                            onClick={() => handleQuickAddCustomFood(food.id)}
                          >
                            + {food.name}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="nutrition-item-editor-list">
                      {mealItemDrafts.length === 0 && (
                        <p className="nutrition-item-meta">No food items yet. Add one to build the meal.</p>
                      )}
                      {mealItemDrafts.map((item) => {
                        const selectedFood = customFoodsById.get(item.customFoodId);
                        return (
                          <article key={item.id} className="nutrition-item-editor">
                            <div className="nutrition-form-row nutrition-meal-item-row">
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
                                Amount (g)
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
                                {selectedFood.caloriesPerUnit} kcal/g • {selectedFood.proteinGramsPerUnit}P/
                                {selectedFood.carbsGramsPerUnit}C/{selectedFood.fatGramsPerUnit}F
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
                </>
              )}
            </section>

            <section className="nutrition-tool-panel">
              <div className="nutrition-custom-food-header">
                <h4>Custom foods</h4>
                <div className="nutrition-tool-header-actions">
                  {editingCustomFoodId && (
                    <button type="button" onClick={resetCustomFoodDraft}>
                      Cancel edit
                    </button>
                  )}
                  <button type="button" onClick={() => setShowCustomFoodsPanel((current) => !current)}>
                    {showCustomFoodsPanel ? "Hide" : "Expand"}
                  </button>
                </div>
              </div>
              {showCustomFoodsPanel && (
                <>
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
                    </div>
                    <div className="nutrition-form-row">
                      <label>
                        Protein / g
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          value={customFoodDraft.proteinGramsPerUnit}
                          onChange={(event) =>
                            setCustomFoodDraft({ ...customFoodDraft, proteinGramsPerUnit: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Carbs / g
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          value={customFoodDraft.carbsGramsPerUnit}
                          onChange={(event) => setCustomFoodDraft({ ...customFoodDraft, carbsGramsPerUnit: event.target.value })}
                        />
                      </label>
                      <label>
                        Fat / g
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          value={customFoodDraft.fatGramsPerUnit}
                          onChange={(event) => setCustomFoodDraft({ ...customFoodDraft, fatGramsPerUnit: event.target.value })}
                        />
                      </label>
                    </div>
                    <p className="nutrition-item-meta">Calories / g (auto): {formatPerUnitMetric(customFoodDraftCalories)} kcal</p>
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
                              {formatPerUnitMetric(food.caloriesPerUnit)} kcal/g • {formatPerUnitMetric(food.proteinGramsPerUnit)}P/
                              {formatPerUnitMetric(food.carbsGramsPerUnit)}C/{formatPerUnitMetric(food.fatGramsPerUnit)}F
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
                </>
              )}
            </section>
          </article>

          <article className="nutrition-card">
            <h3>Meals</h3>
            {meals.length === 0 ? (
              <p>No meals logged yet.</p>
            ) : (
              <div className="nutrition-list">
                {meals.map((meal) => (
                  <article
                    key={meal.id}
                    className={`nutrition-list-item nutrition-meal-card ${isMealCompleted(meal) ? "nutrition-meal-card-complete" : ""}`}
                  >
                    <div className="nutrition-meal-card-header">
                      <div>
                        <p className="nutrition-item-title">{meal.name}</p>
                        <p className="nutrition-item-meta">{formatDateTime(meal.consumedAt)}</p>
                      </div>
                      <div className="nutrition-list-item-actions nutrition-quick-controls">
                        <button
                          type="button"
                          onClick={() => void handleMoveMeal(meal.id, "up")}
                          aria-label="Move meal up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleMoveMeal(meal.id, "down")}
                          aria-label="Move meal down"
                        >
                          ↓
                        </button>
                        <button type="button" onClick={() => void handleDeleteMeal(meal.id)}>
                          Delete
                        </button>
                      </div>
                    </div>

                    <ul className="nutrition-meal-item-list nutrition-meal-food-list">
                      {meal.items.map((item, index) => {
                        const itemCalories = Math.round(item.quantity * item.caloriesPerUnit);
                        return (
                          <li key={`${item.id ?? item.customFoodId ?? item.name}-${index}`} className="nutrition-meal-food-item">
                            <p className="nutrition-meal-food-name">{item.name}</p>
                            <div className="nutrition-meal-food-bottom">
                              <div className="nutrition-meal-food-main">
                                <span>
                                  {formatMetric(item.quantity)}
                                  g
                                </span>
                                <span>{itemCalories} kcal</span>
                              </div>
                              <div className="nutrition-meal-food-actions">
                                <button
                                  type="button"
                                  onClick={() => void handleAdjustMealItemQuantity(meal.id, index, -1)}
                                  aria-label="Decrease food amount"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleAdjustMealItemQuantity(meal.id, index, 1)}
                                  aria-label="Increase food amount"
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  className="nutrition-secondary-button"
                                  onClick={() => void handleRemoveMealItem(meal.id, index)}
                                  aria-label="Remove food item"
                                >
                                  🗑
                                </button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="nutrition-meal-add-food-row">
                      <select
                        value={mealFoodPickerByMeal[meal.id] ?? customFoods[0]?.id ?? ""}
                        onChange={(event) => handleMealFoodPickerChange(meal.id, event.target.value)}
                      >
                        {customFoods.length === 0 && <option value="">No custom foods</option>}
                        {customFoods.map((food) => (
                          <option key={food.id} value={food.id}>
                            {food.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => void handleAddFoodToMeal(meal.id)} disabled={customFoods.length === 0}>
                        + Add food
                      </button>
                    </div>

                    <div className="nutrition-meal-status-row">
                      <button
                        type="button"
                        className={`nutrition-thumb-button ${isMealCompleted(meal) ? "nutrition-action-done" : ""}`}
                        onClick={() => void handleToggleMealCompleted(meal.id)}
                        aria-label={isMealCompleted(meal) ? "Mark meal as not eaten" : "Mark meal as eaten"}
                      >
                        {isMealCompleted(meal) ? "✓ Eaten" : "○ Mark eaten"}
                      </button>
                    </div>

                    <div className="nutrition-meal-macro-grid">
                      <p>
                        <span>Protein</span>
                        <strong>{formatMetric(meal.proteinGrams)}g</strong>
                      </p>
                      <p>
                        <span>Carbs</span>
                        <strong>{formatMetric(meal.carbsGrams)}g</strong>
                      </p>
                      <p>
                        <span>Fat</span>
                        <strong>{formatMetric(meal.fatGrams)}g</strong>
                      </p>
                      <p>
                        <span>Calories</span>
                        <strong>{Math.round(mealDisplayCalories(meal))}</strong>
                      </p>
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
                  <p className={`nutrition-daily-delta ${intakeDeltas ? deltaToneClass("proteinGrams", intakeDeltas.proteinGrams) : "nutrition-delta-neutral"}`}>
                    {intakeDeltas ? formatSignedDelta(intakeDeltas.proteinGrams, "g") : "Set targets"}
                  </p>
                </article>
                <article className="nutrition-daily-metric">
                  <p className="summary-label">Carbs</p>
                  <p className="summary-value">{summary ? `${formatMetric(summary.totals.carbsGrams)}g` : "0g"}</p>
                  <p className={`nutrition-daily-delta ${intakeDeltas ? deltaToneClass("carbsGrams", intakeDeltas.carbsGrams) : "nutrition-delta-neutral"}`}>
                    {intakeDeltas ? formatSignedDelta(intakeDeltas.carbsGrams, "g") : "Set targets"}
                  </p>
                </article>
                <article className="nutrition-daily-metric">
                  <p className="summary-label">Fat</p>
                  <p className="summary-value">{summary ? `${formatMetric(summary.totals.fatGrams)}g` : "0g"}</p>
                  <p className={`nutrition-daily-delta ${intakeDeltas ? deltaToneClass("fatGrams", intakeDeltas.fatGrams) : "nutrition-delta-neutral"}`}>
                    {intakeDeltas ? formatSignedDelta(intakeDeltas.fatGrams, "g") : "Set targets"}
                  </p>
                </article>
                <article className="nutrition-daily-metric">
                  <p className="summary-label">Calories</p>
                  <p className="summary-value">{summary ? String(Math.round(dailyDisplayCalories)) : "0"} kcal</p>
                  <p className={`nutrition-daily-delta ${intakeDeltas ? deltaToneClass("calories", intakeDeltas.calories) : "nutrition-delta-neutral"}`}>
                    {intakeDeltas ? formatSignedDelta(intakeDeltas.calories, " kcal") : "Set targets"}
                  </p>
                </article>
              </div>
            )}
          </article>
        </>
      )}

      {activeTab === "settings" && (
        <article className="nutrition-card">
          <div>
            <h3>Plan settings</h3>
            <p className="nutrition-item-meta">
              Set weight, maintenance, and surplus to derive targets. Protein/fat use g/lb bodyweight and carbs are
              auto-filled from remaining calories.
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

            <div className="nutrition-form-row nutrition-target-grid">
              <label>
                Protein target (g/lb bodyweight)
                <input
                  type="number"
                  min={0.7}
                  max={1}
                  step="0.01"
                  value={targetDraft.proteinGramsPerLb}
                  onChange={(event) => updateTargetDraftField("proteinGramsPerLb", event.target.value)}
                />
                {macroRanges && (
                  <small>
                    Recommended {formatMetric(macroRanges.proteinPerLbMin)}-{formatMetric(macroRanges.proteinPerLbMax)} g/lb
                    ({formatMetric(macroRanges.proteinMin)}-{formatMetric(macroRanges.proteinMax)}g)
                  </small>
                )}
              </label>
              <label>
                Fat target (g/lb bodyweight)
                <input
                  type="number"
                  min={0.3}
                  max={0.5}
                  step="0.01"
                  value={targetDraft.fatGramsPerLb}
                  onChange={(event) => updateTargetDraftField("fatGramsPerLb", event.target.value)}
                />
                {macroRanges && (
                  <small>
                    Recommended {formatMetric(macroRanges.fatPerLbMin)}-{formatMetric(macroRanges.fatPerLbMax)} g/lb
                    ({formatMetric(macroRanges.fatMin)}-{formatMetric(macroRanges.fatMax)}g)
                  </small>
                )}
              </label>
            </div>
            <p className="nutrition-item-meta">
              Carbs are automatically calculated to fill the remaining calories:{" "}
              {activeTargets ? `${formatMetric(activeTargets.targetCarbsGrams)}g` : "—"}.
            </p>

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
            <div className="nutrition-summary-grid nutrition-target-dashboard">
              <article className="summary-tile nutrition-target-card nutrition-target-card-protein">
                <p className="summary-label">Protein</p>
                <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetProteinGrams)}g` : "—"}</p>
              </article>
              <article className="summary-tile nutrition-target-card nutrition-target-card-carbs">
                <p className="summary-label">Carbs</p>
                <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetCarbsGrams)}g` : "—"}</p>
              </article>
              <article className="summary-tile nutrition-target-card nutrition-target-card-fat">
                <p className="summary-label">Fat</p>
                <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetFatGrams)}g` : "—"}</p>
              </article>
              <article className="summary-tile nutrition-target-card nutrition-target-card-calories">
                <p className="summary-label">Calories</p>
                <p className="summary-value">{activeTargets ? `${formatMetric(activeTargets.targetCalories)} kcal` : "—"}</p>
              </article>
            </div>
          </div>
        </article>
      )}
    </section>
  );
}
