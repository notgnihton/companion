import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import { getDeadlines, getHabits, getWeeklySummary } from "../lib/api";
import { loadContext } from "../lib/storage";
import { Deadline, Habit } from "../types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler
);

interface WeeklyData {
  week: string;
  completionRate: number;
  deadlinesCompleted: number;
  deadlinesDue: number;
}

export function AnalyticsDashboard(): JSX.Element {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [weeklyData, setWeeklyData] = useState<WeeklyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async (): Promise<void> => {
      try {
        const [deadlineData, habitData] = await Promise.all([
          getDeadlines(),
          getHabits()
        ]);
        
        setDeadlines(deadlineData);
        setHabits(habitData);

        // Generate weekly data for the past 8 weeks
        const weeks: WeeklyData[] = [];
        for (let i = 7; i >= 0; i--) {
          const referenceDate = new Date();
          referenceDate.setDate(referenceDate.getDate() - (i * 7));
          
          try {
            const summary = await getWeeklySummary(referenceDate.toISOString());
            if (summary) {
              weeks.push({
                week: new Date(summary.windowStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                completionRate: summary.completionRate,
                deadlinesCompleted: summary.deadlinesCompleted,
                deadlinesDue: summary.deadlinesDue
              });
            }
          } catch {
            // Skip weeks without data
          }
        }
        
        setWeeklyData(weeks);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, []);

  if (loading) {
    return <div className="analytics-container"><p>Loading analytics...</p></div>;
  }

  // Deadline completion rate chart data
  const completionRateData = {
    labels: weeklyData.map(w => w.week),
    datasets: [
      {
        label: 'Completion Rate (%)',
        data: weeklyData.map(w => w.completionRate),
        borderColor: 'rgb(125, 211, 168)',
        backgroundColor: 'rgba(125, 211, 168, 0.1)',
        fill: true,
        tension: 0.4
      }
    ]
  };

  // Week-over-week productivity chart data
  const productivityData = {
    labels: weeklyData.map(w => w.week),
    datasets: [
      {
        label: 'Completed',
        data: weeklyData.map(w => w.deadlinesCompleted),
        backgroundColor: 'rgba(125, 211, 168, 0.6)',
      },
      {
        label: 'Total Due',
        data: weeklyData.map(w => w.deadlinesDue),
        backgroundColor: 'rgba(246, 195, 127, 0.6)',
      }
    ]
  };

  // Habit streak heatmap data (last 30 days)
  const today = new Date();
  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (29 - i));
    return date.toISOString().split('T')[0];
  });

  // Calculate completion count per day across all habits
  const dailyCompletions = last30Days.map(date => {
    let count = 0;
    habits.forEach(habit => {
      const checkIn = habit.recentCheckIns?.find(ci => ci.date === date);
      if (checkIn?.completed) count++;
    });
    return count;
  });

  const heatmapData = {
    labels: last30Days.map(date => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
    datasets: [
      {
        label: 'Habits Completed',
        data: dailyCompletions,
        backgroundColor: dailyCompletions.map(count => {
          if (count === 0) return 'rgba(255, 138, 128, 0.3)';
          if (count < 3) return 'rgba(246, 195, 127, 0.5)';
          return 'rgba(125, 211, 168, 0.7)';
        }),
      }
    ]
  };

  // Energy/Stress patterns - using current context values
  // Note: Historical context tracking would be needed for true patterns over time
  const last14Days = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (13 - i));
    return date.toISOString().split('T')[0];
  });

  // Mock data for now - would need context history to be stored
  // Currently shows baseline levels; future enhancement: track daily context changes
  const context = loadContext();
  const stressLevelMap = { low: 1, medium: 2, high: 3 };
  const energyLevelMap = { low: 1, medium: 2, high: 3 };

  const energyStressData = {
    labels: last14Days.map(date => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
    datasets: [
      {
        label: 'Energy Level',
        data: last14Days.map(() => energyLevelMap[context.energyLevel] || 2),
        borderColor: 'rgb(125, 211, 168)',
        backgroundColor: 'rgba(125, 211, 168, 0.1)',
        fill: false,
        tension: 0.4
      },
      {
        label: 'Stress Level',
        data: last14Days.map(() => stressLevelMap[context.stressLevel] || 2),
        borderColor: 'rgb(255, 138, 128)',
        backgroundColor: 'rgba(255, 138, 128, 0.1)',
        fill: false,
        tension: 0.4
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: 'var(--text)'
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: 'var(--muted)'
        },
        grid: {
          color: 'var(--border-subtle)'
        }
      },
      y: {
        ticks: {
          color: 'var(--muted)'
        },
        grid: {
          color: 'var(--border-subtle)'
        }
      }
    }
  };

  return (
    <div className="analytics-container">
      <h2 className="analytics-title">📊 Analytics Dashboard</h2>
      
      <div className="analytics-grid">
        <div className="analytics-card">
          <h3>Deadline Completion Rate</h3>
          <div className="chart-container">
            <Line data={completionRateData} options={{
              ...chartOptions,
              scales: {
                ...chartOptions.scales,
                y: {
                  ...chartOptions.scales.y,
                  min: 0,
                  max: 100,
                  ticks: {
                    ...chartOptions.scales.y.ticks,
                    callback: (value) => `${value}%`
                  }
                }
              }
            }} />
          </div>
        </div>

        <div className="analytics-card">
          <h3>Habit Streak Heatmap</h3>
          <div className="chart-container">
            <Bar data={heatmapData} options={{
              ...chartOptions,
              scales: {
                ...chartOptions.scales,
                y: {
                  ...chartOptions.scales.y,
                  beginAtZero: true,
                  ticks: {
                    ...chartOptions.scales.y.ticks,
                    stepSize: 1
                  }
                }
              }
            }} />
          </div>
        </div>

        <div className="analytics-card">
          <h3>Energy & Stress Patterns (Current Levels)</h3>
          <div className="chart-container">
            <Line data={energyStressData} options={{
              ...chartOptions,
              scales: {
                ...chartOptions.scales,
                y: {
                  ...chartOptions.scales.y,
                  min: 0,
                  max: 4,
                  ticks: {
                    ...chartOptions.scales.y.ticks,
                    callback: (value) => {
                      if (value === 1) return 'Low';
                      if (value === 2) return 'Medium';
                      if (value === 3) return 'High';
                      return '';
                    }
                  }
                }
              }
            }} />
          </div>
        </div>

        <div className="analytics-card">
          <h3>Week-over-Week Productivity</h3>
          <div className="chart-container">
            <Bar data={productivityData} options={chartOptions} />
          </div>
        </div>
      </div>
    </div>
  );
}
