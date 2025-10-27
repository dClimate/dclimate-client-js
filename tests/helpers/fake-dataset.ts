type CoordinateKey = "latitude" | "longitude" | "time";

export interface SampleRecord {
  latitude: number;
  longitude: number;
  time: string;
  value: number;
}

const COORDINATE_KEYS: CoordinateKey[] = ["latitude", "longitude", "time"];

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function sortTimes(times: string[]): string[] {
  return [...times].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

function normalizeRecords(records: SampleRecord[]): SampleRecord[] {
  return records.map((record) => ({
    ...record,
    time: new Date(record.time).toISOString(),
  }));
}

function pickNearest(records: SampleRecord[], key: "latitude" | "longitude", target: number): number {
  let best = records[0][key];
  let bestDistance = Math.abs(best - target);
  for (const record of records) {
    const distance = Math.abs(record[key] - target);
    if (distance < bestDistance) {
      best = record[key];
      bestDistance = distance;
    }
  }
  return best;
}

export class FakeDataset {
  private readonly internalRecords: SampleRecord[];
  private readonly coordMap: Record<string, Array<number | string>>;
  private readonly sizeMap: Record<string, number>;
  private readonly variables = ["precipitation"];

  constructor(records: SampleRecord[]) {
    this.internalRecords = normalizeRecords(records);
    this.coordMap = {
      latitude: uniqueValues(this.internalRecords.map((record) => record.latitude)),
      longitude: uniqueValues(this.internalRecords.map((record) => record.longitude)),
      time: sortTimes(uniqueValues(this.internalRecords.map((record) => record.time))),
    };
    this.sizeMap = {
      latitude: this.coordMap.latitude.length,
      longitude: this.coordMap.longitude.length,
      time: this.coordMap.time.length,
    };
  }

  get coords(): Record<string, Array<number | string>> {
    return this.coordMap;
  }

  get sizes(): Record<string, number> {
    return this.sizeMap;
  }

  get dataVars(): string[] {
    return this.variables;
  }

  async sel(selection: Record<string, any>): Promise<FakeDataset> {
    let filtered = this.internalRecords;

    if (typeof selection.latitude === "number") {
      const nearestLat = pickNearest(filtered, "latitude", selection.latitude);
      filtered = filtered.filter((record) => record.latitude === nearestLat);
    }

    if (typeof selection.longitude === "number") {
      const nearestLon = pickNearest(filtered, "longitude", selection.longitude);
      filtered = filtered.filter((record) => record.longitude === nearestLon);
    }

    if (selection.time && typeof selection.time === "object") {
      const { start, stop } = selection.time;
      const startDate = new Date(start);
      const stopDate = new Date(stop);
      filtered = filtered.filter((record) => {
        const recordTime = new Date(record.time);
        return recordTime >= startDate && recordTime <= stopDate;
      });
    }

    if (filtered.length === 0) {
      return new FakeDataset([]);
    }

    return new FakeDataset(filtered);
  }

  async toRecords(
    variableName: string
  ): Promise<Array<Record<CoordinateKey | "value", number | string>>> {
    if (variableName !== "precipitation") {
      return [];
    }
    return this.internalRecords.map((record) => ({
      latitude: record.latitude,
      longitude: record.longitude,
      time: record.time,
      value: record.value,
    }));
  }
}

export const SAMPLE_RECORDS: SampleRecord[] = [
  {
    latitude: 40.75,
    longitude: -73.99,
    time: "2023-01-01T00:00:00Z",
    value: 10,
  },
  {
    latitude: 40.75,
    longitude: -73.99,
    time: "2023-01-04T00:00:00Z",
    value: 12,
  },
  {
    latitude: 40.75,
    longitude: -73.99,
    time: "2023-01-07T00:00:00Z",
    value: 9,
  },
  {
    latitude: 34.05,
    longitude: -118.25,
    time: "2023-01-01T00:00:00Z",
    value: 2,
  },
];

export function createMockDataset(records: SampleRecord[] = SAMPLE_RECORDS): FakeDataset {
  return new FakeDataset(records);
}
