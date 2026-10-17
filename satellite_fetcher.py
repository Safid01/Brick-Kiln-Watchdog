import math
import io
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

def num2deg(xtile, ytile, zoom):
    n = 2.0 ** zoom
    lon_deg = xtile / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * ytile / n)))
    lat_deg = math.degrees(lat_rad)
    return lat_deg, lon_deg

def _get_http_session():
    session = requests.Session()
    retries = Retry(total=3, backoff_factor=0.3, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retries, pool_connections=20, pool_maxsize=20)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

def fetch_tile(session, zoom, x, y, headers):
    url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}"
    try:
        resp = session.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            return Image.open(io.BytesIO(resp.content)).convert("RGB")
    except Exception:
        pass
    # Return placeholder neutral tile on network timeout
    return Image.new("RGB", (256, 256), (128, 128, 128))

def fetch_satellite_composite(min_lat, min_lon, max_lat, max_lon, zoom=16, output_path="scene.jpg"):
    """
    Downloads and stitches high-resolution Esri World Imagery tiles covering the specified bounding box.
    Uses multi-threaded parallel downloads (ThreadPoolExecutor) for maximum throughput across large district spans.
    Default zoom level is 16 (~2.1 meters/pixel) to provide sharp spatial detail for kiln detection.
    Returns: (output_path, actual_bounds) where actual_bounds = (min_lon, min_lat, max_lon, max_lat)
    """
    x_min, y_min = deg2num(max_lat, min_lon, zoom)
    x_max, y_max = deg2num(min_lat, max_lon, zoom)

    x_tiles = list(range(x_min, x_max + 1))
    y_tiles = list(range(y_min, y_max + 1))
    total_tiles = len(x_tiles) * len(y_tiles)

    # Step down zoom gracefully if an immense boundary is requested without prior grid subdividing
    if total_tiles > 400 and zoom > 15:
        return fetch_satellite_composite(min_lat, min_lon, max_lat, max_lon, zoom=15, output_path=output_path)
    if total_tiles > 800 and zoom > 14:
        return fetch_satellite_composite(min_lat, min_lon, max_lat, max_lon, zoom=14, output_path=output_path)

    tile_w, tile_h = 256, 256
    composite = Image.new("RGB", (len(x_tiles) * tile_w, len(y_tiles) * tile_h))

    headers = {"User-Agent": "BrickKilnWatchdog/2.0 (GIS Greater Dhaka Division Enforcement)"}
    session = _get_http_session()

    # Parallel asynchronous tile downloads
    tasks = []
    tile_coords = {}
    with ThreadPoolExecutor(max_workers=14) as executor:
        for i, x in enumerate(x_tiles):
            for j, y in enumerate(y_tiles):
                future = executor.submit(fetch_tile, session, zoom, x, y, headers)
                tasks.append(future)
                tile_coords[future] = (i * tile_w, j * tile_h)

        for future in as_completed(tasks):
            px_pos = tile_coords[future]
            try:
                tile_img = future.result()
                composite.paste(tile_img, px_pos)
            except Exception:
                composite.paste(Image.new("RGB", (tile_w, tile_h), (128, 128, 128)), px_pos)

    # Calculate precise WGS84 geographic extents
    top_lat, left_lon = num2deg(x_min, y_min, zoom)
    bottom_lat, right_lon = num2deg(x_max + 1, y_max + 1, zoom)
    actual_bounds = (left_lon, bottom_lat, right_lon, top_lat)

    composite.save(output_path, quality=95)
    return output_path, actual_bounds