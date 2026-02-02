import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import 'chartjs-adapter-date-fns';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale
);

interface FlightDataPoint {
  flightNumber: string;
  standardSeatsAvailable: number;
  preferedSeatsAvailable: number;
  route: string;
}

interface AggregatedDataPoint {
  timestamp: string;
  date: string;
  lowestDepartureFare: number;
  lowestReturnFare: number;
  departureFares: { [key: string]: number };
  returnFares: { [key: string]: number };
  departureFlights: FlightDataPoint[];
  returnFlights: FlightDataPoint[];
}

const Dashboard: React.FC = () => {
  const [data, setData] = useState<AggregatedDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFareClass, setSelectedFareClass] = useState<string>('ECONOMY (Basic)');
  const [availableFareClasses, setAvailableFareClasses] = useState<string[]>([]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      // Use Vite's glob import to load all flight JSON files
      const modules = import.meta.glob('/output/flight_*.json');
      const jsonData: AggregatedDataPoint[] = [];
      
      // Load each file
      for (const path in modules) {
        try {
          const module: any = await modules[path]();
          const fileData = module.default;
          
          // Extract timestamp from path and convert to standard ISO format
          // /output/flight_2026-01-27.json -> 2026-01-27T00:00:00
          // /output/flight_2026-01-28T14-30-45.json -> 2026-01-28T14:30:45
          const filename = path.split('/').pop()!;
          let timestamp = filename.replace('flight_', '').replace('.json', '');
          
          // Convert time separators from hyphens to colons if timestamp includes time
          if (timestamp.includes('T')) {
            const [datePart, timePart] = timestamp.split('T');
            const normalizedTime = timePart.replace(/-/g, ':');
            timestamp = `${datePart}T${normalizedTime}`;
          } else {
            // Add midnight time for date-only formats
            timestamp = `${timestamp}T00:00:00`;
          }
          
          const departureFaresMap = fileData.departure.fares as { [key: string]: number };
          const returnFaresMap = fileData.return.fares as { [key: string]: number };
          const departureFares = Object.values(departureFaresMap) as number[];
          const returnFares = Object.values(returnFaresMap) as number[];
          
          // Extract just the date portion for standardized display
          const dateOnly = timestamp.split('T')[0];
          
          jsonData.push({
            timestamp: timestamp,
            date: dateOnly,
            lowestDepartureFare: Math.min(...departureFares),
            lowestReturnFare: Math.min(...returnFares),
            departureFares: departureFaresMap,
            returnFares: returnFaresMap,
            departureFlights: fileData.departure.flights.map((f: any) => ({
              flightNumber: f.flightNumber,
              standardSeatsAvailable: f.seatDetails.standardSeatsAvailable,
              preferedSeatsAvailable: f.seatDetails.preferedSeatsAvailable,
              route: `${f.departureAirport} → ${f.arrivalAirport}`
            })),
            returnFlights: fileData.return.flights.map((f: any) => ({
              flightNumber: f.flightNumber,
              standardSeatsAvailable: f.seatDetails.standardSeatsAvailable,
              preferedSeatsAvailable: f.seatDetails.preferedSeatsAvailable,
              route: `${f.departureAirport} → ${f.arrivalAirport}`
            }))
          });
        } catch (err) {
          console.warn(`Failed to load ${path}:`, err);
          continue;
        }
      }
      
      // Sort by full timestamp ascending
      jsonData.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      
      // Extract available fare classes from first data point
      if (jsonData.length > 0) {
        const fareClasses = Object.keys(jsonData[0].departureFares);
        setAvailableFareClasses(fareClasses);
        if (fareClasses.length > 0) {
          setSelectedFareClass(fareClasses[0]);
        }
      }
      
      if (!jsonData || jsonData.length === 0) {
        throw new Error('No data available. Generate flight data files first.');
      }

      setData(jsonData);
      setLoading(false);
      setError(null);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  if (loading) {
    return <div className="loading">Loading data...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  const dates = data.map(d => d.date);
  const latest = data[data.length - 1];
  const previous = data.length > 1 ? data[data.length - 2] : null;

  // Fares data
  const faresData = {
    datasets: [
      {
        label: `Departure ${selectedFareClass}`,
        data: data.map(d => ({ x: d.timestamp, y: d.departureFares[selectedFareClass] || d.lowestDepartureFare })),
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        tension: 0.1,
        fill: true,
        pointRadius: 5,
        pointHoverRadius: 7,
      },
      {
        label: `Return ${selectedFareClass}`,
        data: data.map(d => ({ x: d.timestamp, y: d.returnFares[selectedFareClass] || d.lowestReturnFare })),
        borderColor: '#764ba2',
        backgroundColor: 'rgba(118, 75, 162, 0.1)',
        tension: 0.1,
        fill: true,
        pointRadius: 5,
        pointHoverRadius: 7,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          font: {
            size: 10
          },
          boxWidth: 15
        }
      }
    },
    scales: {
      y: {
        beginAtZero: false,
        title: {
          display: true,
          text: 'Price ($)',
          font: {
            size: 10
          }
        },
        ticks: {
          font: {
            size: 9
          }
        }
      },
      x: {
        type: 'time' as const,
        time: {
          unit: 'day' as const,
          displayFormats: {
            day: 'MMM dd'
          }
        },
        ticks: {
          font: {
            size: 9
          }
        }
      }
    }
  };

  // Get all unique flights
  const flightMap = new Map<string, {
    flightNumber: string;
    route: string;
    standardSeats: number[];
    preferredSeats: number[];
  }>();

  data.forEach(d => {
    d.departureFlights.forEach(f => {
      if (!flightMap.has(f.flightNumber)) {
        flightMap.set(f.flightNumber, {
          flightNumber: f.flightNumber,
          route: f.route,
          standardSeats: [],
          preferredSeats: []
        });
      }
    });
    d.returnFlights.forEach(f => {
      if (!flightMap.has(f.flightNumber)) {
        flightMap.set(f.flightNumber, {
          flightNumber: f.flightNumber,
          route: f.route,
          standardSeats: [],
          preferredSeats: []
        });
      }
    });
  });

  // Populate data for each flight
  data.forEach(d => {
    d.departureFlights.forEach(f => {
      const flight = flightMap.get(f.flightNumber);
      if (flight) {
        flight.standardSeats.push(f.standardSeatsAvailable);
        flight.preferredSeats.push(f.preferedSeatsAvailable);
      }
    });
    d.returnFlights.forEach(f => {
      const flight = flightMap.get(f.flightNumber);
      if (flight) {
        flight.standardSeats.push(f.standardSeatsAvailable);
        flight.preferredSeats.push(f.preferedSeatsAvailable);
      }
    });
  });

  // Stats calculations
  const totalDepartureStandard = latest.departureFlights.reduce((sum, f) => sum + f.standardSeatsAvailable, 0);
  const totalReturnStandard = latest.returnFlights.reduce((sum, f) => sum + f.standardSeatsAvailable, 0);
  const prevDepartureStandard = previous ? previous.departureFlights.reduce((sum, f) => sum + f.standardSeatsAvailable, 0) : 0;
  const prevReturnStandard = previous ? previous.returnFlights.reduce((sum, f) => sum + f.standardSeatsAvailable, 0) : 0;

  const currentDepartureFare = latest.departureFares[selectedFareClass] || latest.lowestDepartureFare;
  const previousDepartureFare = previous ? (previous.departureFares[selectedFareClass] || previous.lowestDepartureFare) : currentDepartureFare;
  const currentReturnFare = latest.returnFares[selectedFareClass] || latest.lowestReturnFare;
  const previousReturnFare = previous ? (previous.returnFares[selectedFareClass] || previous.lowestReturnFare) : currentReturnFare;

  const stats = [
    {
      label: `Departure ${selectedFareClass}`,
      value: `$${currentDepartureFare}`,
      change: currentDepartureFare - previousDepartureFare
    },
    {
      label: `Return ${selectedFareClass}`,
      value: `$${currentReturnFare}`,
      change: currentReturnFare - previousReturnFare
    },
    {
      label: 'Total Departure Seats',
      value: totalDepartureStandard,
      change: previous ? totalDepartureStandard - prevDepartureStandard : 0
    },
    {
      label: 'Total Return Seats',
      value: totalReturnStandard,
      change: previous ? totalReturnStandard - prevReturnStandard : 0
    }
  ];

  return (
    <div className="container">
      <h1>🛫 Seat Watch - Flight Tracker</h1>
      <p className="subtitle">Monitor flight prices and seat availability over time</p>

      <div className="fare-selector">
        <div className="selector-group">
          <label htmlFor="fare-class">Fare Class:</label>
          <select
            id="fare-class"
            value={selectedFareClass}
            onChange={(e) => setSelectedFareClass(e.target.value)}
          >
            {availableFareClasses.map((fareClass) => (
              <option key={fareClass} value={fareClass}>
                {fareClass}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-container">
          <h2>Fares Over Time</h2>
          <Line data={faresData} options={chartOptions} />
        </div>

        {Array.from(flightMap.values()).map(flight => {
          const flightData = {
            datasets: [
              {
                label: 'Standard Seats',
                data: data.map((d, idx) => ({ x: d.timestamp, y: flight.standardSeats[idx] })),
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.1,
                fill: true,
                pointRadius: 5,
                pointHoverRadius: 7,
              },
              {
                label: 'Preferred Seats',
                data: data.map((d, idx) => ({ x: d.timestamp, y: flight.preferredSeats[idx] })),
                borderColor: '#764ba2',
                backgroundColor: 'rgba(118, 75, 162, 0.1)',
                tension: 0.1,
                fill: true,
                pointRadius: 5,
                pointHoverRadius: 7,
              }
            ]
          };

          const seatsChartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                position: 'top' as const,
                labels: {
                  font: {
                    size: 10
                  },
                  boxWidth: 15
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Available Seats',
                  font: {
                    size: 10
                  }
                },
                ticks: {
                  font: {
                    size: 9
                  }
                }
              },
              x: {
                type: 'time' as const,
                time: {
                  unit: 'day' as const,
                  displayFormats: {
                    day: 'MMM dd'
                  }
                },
                ticks: {
                  font: {
                    size: 9
                  }
                }
              }
            }
          };

          return (
            <div key={flight.flightNumber} className="chart-container">
              <h2>{flight.flightNumber} - {flight.route}</h2>
              <Line data={flightData} options={seatsChartOptions} />
            </div>
          );
        })}
      </div>

      <div className="stats-grid">
        {stats.map((stat, index) => {
          const changeSymbol = stat.change > 0 ? '↑' : '↓';
          
          return (
            <div key={index} className="stat-card">
              <div className="stat-label">{stat.label}</div>
              <div className="stat-value">{stat.value}</div>
              {stat.change !== 0 && (
                <div className="stat-change">
                  {changeSymbol} {Math.abs(stat.change)} from yesterday
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="last-updated">Last updated: {latest.date}</div>
    </div>
  );
};

export default Dashboard;
