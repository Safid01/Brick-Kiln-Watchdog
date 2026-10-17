// Official Geographic Bounding Boxes for all 13 Districts in Greater Dhaka Division
export const DISTRICT_BOXES: Record<
  string,
  { name: string; bounds: [[number, number], [number, number]]; color: string; desc: string }
> = {
  Dhaka: {
    name: "Dhaka District",
    bounds: [[23.5300, 90.0100], [24.0300, 90.5800]],
    color: "#38bdf8",
    desc: "Savar, Keraniganj, Nawabganj, Dhamrai, Dohar",
  },
  Gazipur: {
    name: "Gazipur District",
    bounds: [[23.8800, 90.1500], [24.3500, 90.7000]],
    color: "#818cf8",
    desc: "Turag, Konabari, Kaliakair, Sreepur, Shitalakshya",
  },
  Narayanganj: {
    name: "Narayanganj District",
    bounds: [[23.5300, 90.4500], [23.8200, 90.7600]],
    color: "#f472b6",
    desc: "Shitalakshya, Meghna Basin, Sonargaon, Rupganj",
  },
  Tangail: {
    name: "Tangail District",
    bounds: [[24.0100, 89.7000], [24.8000, 90.3000]],
    color: "#fb923c",
    desc: "Jamuna Floodplains, Mirzapur, Kalihati, Sadar",
  },
  Narsingdi: {
    name: "Narsingdi District",
    bounds: [[23.7500, 90.5500], [24.2500, 90.9500]],
    color: "#fbbf24",
    desc: "Meghna Industrial Corridor, Palash, Raipura",
  },
  Manikganj: {
    name: "Manikganj District",
    bounds: [[23.6300, 89.7000], [24.0500, 90.2800]],
    color: "#a3e635",
    desc: "Dhaleshwari, Kaliganga, Singair, Shibalaya",
  },
  Munshiganj: {
    name: "Munshiganj District",
    bounds: [[23.3800, 90.1500], [23.6800, 90.7200]],
    color: "#2dd4bf",
    desc: "Gazaria Meghna Basin, Sirajdikhan, Tongibari",
  },
  Faridpur: {
    name: "Faridpur District",
    bounds: [[23.2800, 89.5000], [23.8000, 90.2500]],
    color: "#34d399",
    desc: "Padma & Kumar Floodplains, Bhanga Hub",
  },
  Kishoreganj: {
    name: "Kishoreganj District",
    bounds: [[24.0500, 90.5800], [24.6800, 91.1800]],
    color: "#60a5fa",
    desc: "Bhairab Meghna Brick Hub, Kuliarchar, Brahmaputra",
  },
  Gopalganj: {
    name: "Gopalganj District",
    bounds: [[22.8800, 89.6500], [23.3800, 90.1500]],
    color: "#c084fc",
    desc: "Madhumati River Basin, Muksudpur, Sadar",
  },
  Madaripur: {
    name: "Madaripur District",
    bounds: [[23.0000, 89.9500], [23.5000, 90.4500]],
    color: "#f87171",
    desc: "Padma Bridge Approach Corridor, Shibchar, Arial Khan",
  },
  Rajbari: {
    name: "Rajbari District",
    bounds: [[23.5500, 89.3000], [23.8800, 89.9500]],
    color: "#e879f9",
    desc: "Padma Embankment, Goalanda Ghat, Pangsha",
  },
  Shariatpur: {
    name: "Shariatpur District",
    bounds: [[23.1000, 90.2000], [23.4500, 90.6500]],
    color: "#a78bfa",
    desc: "Jajira, Naria, Kirtinasha & Meghna Floodplains",
  },
};

// Macro envelope bounding the entire Greater Dhaka Division
export const DHAKA_DIVISION_MACRO_BOUNDS: [[number, number], [number, number]] = [
  [22.8000, 89.3000],
  [24.8500, 91.1800],
];

export function detectDistrictName(lat: number, lon: number): string {
  for (const [key, d] of Object.entries(DISTRICT_BOXES)) {
    const [[minLat, minLon], [maxLat, maxLon]] = d.bounds;
    if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) {
      return key;
    }
  }
  return "Dhaka";
}
