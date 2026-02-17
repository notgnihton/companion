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
  updateNutritionCustomFood
} from "../lib/api";
import {
  NutritionCustomFood,
  NutritionDailySummary,
  NutritionMeal,
  NutritionMealPlanBlock,
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

export function NutritionView(): JSX.Element {
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const [summary, setSummary] = useState<NutritionDailySummary | null>(null);
  const [meals, setMeals] = useState<NutritionMeal[]>([]);
  const [mealPlanBlocks, setMealPlanBlocks] = useState<NutritionMealPlanBlock[]>([]);
  const [customFoods, setCustomFoods] = useState<NutritionCustomFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [editingCustomFoodId, setEditingCustomFoodId] = useState<string | null>(null);

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
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

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
    await refresh();
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
          <h2>Macros today</h2>
        </div>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      {message && <p className="nutrition-message">{message}</p>}

      {loading ? (
        <p>Loading nutrition...</p>
      ) : (
        <div className="nutrition-summary-grid">
          <article className="summary-tile">
            <p className="summary-label">Calories</p>
            <p className="summary-value">{summary?.totals.calories ?? 0}</p>
          </article>
          <article className="summary-tile">
            <p className="summary-label">Protein</p>
            <p className="summary-value">{summary?.totals.proteinGrams ?? 0}g</p>
          </article>
          <article className="summary-tile">
            <p className="summary-label">Carbs</p>
            <p className="summary-value">{summary?.totals.carbsGrams ?? 0}g</p>
          </article>
          <article className="summary-tile">
            <p className="summary-label">Fat</p>
            <p className="summary-value">{summary?.totals.fatGrams ?? 0}g</p>
          </article>
        </div>
      )}

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
                <button type="button" onClick={() => void handleDeleteMeal(meal.id)}>
                  Delete
                </button>
              </article>
            ))}
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
            {mealPlanBlocks.map((block) => (
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
                <button type="button" onClick={() => void handleDeletePlanBlock(block.id)}>
                  Delete
                </button>
              </article>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
