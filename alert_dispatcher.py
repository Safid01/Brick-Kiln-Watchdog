import os
import json
from datetime import datetime, timezone
import requests
from PIL import Image, ImageDraw

def create_evidence_crop(source_img_path, bbox, output_crop_path):
    img = Image.open(source_img_path)
    x1, y1, x2, y2 = bbox
    padding = 25
    w, h = img.size

    crop_box = (
        max(0, x1 - padding),
        max(0, y1 - padding),
        min(w, x2 + padding),
        min(h, y2 + padding)
    )
    cropped = img.crop(crop_box)

    # Draw target box on the cropped evidence patch
    draw = ImageDraw.Draw(cropped)
    draw.rectangle(
        [padding, padding, padding + (x2 - x1), padding + (y2 - y1)],
        outline="#EF4444",
        width=3
    )
    cropped.save(output_crop_path, quality=90)
    return output_crop_path

def dispatch_alert(finding, evidence_img_path, telegram_token=None, telegram_chat_id=None):
    """
    Creates a JSON outbox file for web consumption and sends an optional Telegram alert.
    """
    payload = {
        "event": "POTENTIAL_KILN_VIOLATION",
        "kiln_id": finding["kiln_id"],
        "region": finding.get("region", "Savar"),
        "coordinates": {
            "latitude": finding["latitude"],
            "longitude": finding["longitude"]
        },
        "technology": finding.get("technology", {
            "type": "FCBTK",
            "label": "FCBTK (Fixed Chimney Bull's Trench)",
            "badge": "FCBTK (Banned)",
            "compliance_status": "BANNED_ILLEGAL",
            "emission_tier": "High Emissions (Illegal Polluter)",
            "banned": True
        }),
        "operational_status": finding.get("operational_status", {
            "state": "OPERATIONAL",
            "label": "Kiln Facility"
        }),
        "dimensions": finding.get("dimensions", {
            "length_m": finding.get("length_meters", 85.0),
            "width_m": finding.get("width_meters", 42.0),
            "aspect_ratio": 2.02,
            "area_sqm": 3570.0,
            "estimated_capacity": 78500
        }),
        "audit_metrics": {
            "confidence": finding["confidence"],
            "estimated_length_m": finding["length_meters"],
            "estimated_width_m": finding.get("width_meters", round(finding["length_meters"] * 0.48, 1)),
            "distance_to_receptor_m": finding["min_distance_m"],
            "nearest_receptor": finding["nearest_facility_name"],
            "receptor_type": finding["facility_type"],
            "priority_tier": finding["priority_tier"],
            "nearest_receptor_coords": finding.get("nearest_receptor_coords", {})
        },
        "statutory_basis": "Brick Manufacturing and Kiln Construction (Control) Act - 1,000m Buffer Mandate",
        "evidence_image": evidence_img_path,
        "audit_timestamp": datetime.now(timezone.utc).isoformat(),
        "audit_date_formatted": datetime.now().strftime("%d %b %Y, %H:%M:%S"),
        "status": finding.get("status", "REQUIRES_HUMAN_VERIFICATION")
    }

    if "human_verification" in finding and finding["human_verification"]:
        payload["human_verification"] = finding["human_verification"]

    # Save to outbox for the web backend to serve via API
    os.makedirs("alerts_outbox", exist_ok=True)
    outbox_file = f"alerts_outbox/{finding['kiln_id']}.json"
    with open(outbox_file, "w") as f:
        json.dump(payload, f, indent=2)

    # Optional: Send Telegram notification
    if telegram_token and telegram_chat_id:
        msg = (
            f"🚨 *POTENTIAL BRICK KILN VIOLATION*\n\n"
            f"🆔 *ID:* `{finding['kiln_id']}`\n"
            f"📍 *GPS:* `{finding['latitude']}, {finding['longitude']}`\n"
            f"⚠️ *Priority:* *{finding['priority_tier']}*\n"
            f"🏫 *Infringed Receptor:* {finding['nearest_facility_name']} ({finding['facility_type']})\n"
            f"📏 *Distance:* *{finding['min_distance_m']}m* (Statutory limit: 1,000m)\n"
            f"🎯 *Confidence:* `{finding['confidence']*100:.1f}%`\n\n"
            f"🔗 [Open on Google Maps](https://maps.google.com/?q={finding['latitude']},{finding['longitude']})"
        )
        url = f"https://api.telegram.org/bot{telegram_token}/sendPhoto"
        try:
            with open(evidence_img_path, "rb") as photo:
                requests.post(url, data={"chat_id": telegram_chat_id, "caption": msg, "parse_mode": "Markdown"}, files={"photo": photo}, timeout=10)
        except Exception as e:
            print(f"Telegram dispatch failed: {e}")

    return payload