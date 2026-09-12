"""
gojo_hands.py
Standalone Native Desktop Python version of Gojo's Cursed Techniques AR
Uses OpenCV, MediaPipe, and NumPy to track hand joints, render hand lines & dots,
and generate Blue, Red, and Hollow Purple visual effects directly on desktop.

Requirements:
    pip install opencv-python mediapipe numpy

Usage:
    python gojo_hands.py
"""

import math
import random
import time
import sys

try:
    import cv2
    import numpy as np
    import mediapipe as mp
except ImportError:
    print("\n[!] Missing Python packages for the desktop version.")
    print("    To run this Python desktop app, install the required packages:")
    print("    pip install opencv-python mediapipe numpy\n")
    sys.exit(1)


class Particle:
    def __init__(self, x, y, vx, vy, color, size, life):
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.color = color
        self.size = size
        self.life = life
        self.max_life = max(0.01, life)

    def update(self, dt):
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.life -= dt
        return self.life > 0


class GojoARDesktop:
    def __init__(self):
        self.mp_hands = mp.solutions.hands
        self.hands = self.mp_hands.Hands(
            max_num_hands=2,
            model_complexity=0,
            min_detection_confidence=0.6,
            min_tracking_confidence=0.55
        )
        self.mp_draw = mp.solutions.drawing_utils

        self.cap = cv2.VideoCapture(0)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 960)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 540)

        self.state = "NEUTRAL"
        self.particles = []
        self.prev_time = time.time()
        self.fps = 30
        self.purple_start_time = 0
        self.purple_progress = 0

    def run(self):
        print("\n=======================================================")
        print("  GOJO CURSED TECHNIQUES AR (PYTHON / OPENCV)")
        print("  - Open Palm: Lapse: Blue")
        print("  - Point Index: Reversal: Red")
        print("  - Bring Both Hands Together: Hollow Purple")
        print("  - Press 'q' to exit")
        print("=======================================================\n")

        while self.cap.isOpened():
            ret, frame = self.cap.read()
            if not ret:
                break

            now = time.time()
            dt = max(0.001, min(0.1, now - self.prev_time))
            self.fps = int(1.0 / dt)
            self.prev_time = now

            # Mirror webcam feed horizontally
            frame = cv2.flip(frame, 1)
            h, w, _ = frame.shape

            # Convert to RGB for MediaPipe
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.hands.process(rgb)

            detected_hands = []

            if results.multi_hand_landmarks:
                for hand_lms in results.multi_hand_landmarks:
                    pts = []
                    for lm in hand_lms.landmark:
                        px = int(lm.x * w)
                        py = int(lm.y * h)
                        pts.append((px, py))

                    palm_center = (
                        (pts[0][0] + pts[5][0] + pts[9][0] + pts[17][0]) // 4,
                        (pts[0][1] + pts[5][1] + pts[9][1] + pts[17][1]) // 4
                    )
                    gesture = self._classify_hand(pts)
                    detected_hands.append({
                        'pts': pts,
                        'palm': palm_center,
                        'gesture': gesture
                    })

                    # Render Glowing Handlines & Joint Dots (Always Visible)
                    self._draw_cursed_hand_skeleton(frame, pts)

            # Update State Machine
            self._update_state(detected_hands, now, dt, w, h)

            # Render VFX & Particles
            self._render_vfx(frame, detected_hands, dt)

            # Draw HUD
            self._draw_hud(frame)

            cv2.imshow("Gojo Cursed Techniques AR", frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                break

        self.cap.release()
        cv2.destroyAllWindows()

    def _draw_cursed_hand_skeleton(self, frame, pts):
        # Determine energy color
        if self.state == "BLUE":
            line_color = (255, 220, 0)      # Cyan in BGR
            dot_color = (255, 255, 255)
            glow_color = (255, 150, 0)
        elif self.state == "RED":
            line_color = (60, 0, 255)       # Crimson in BGR
            dot_color = (200, 200, 255)
            glow_color = (30, 0, 200)
        elif "PURPLE" in self.state:
            line_color = (255, 60, 180)     # Violet in BGR
            dot_color = (255, 255, 255)
            glow_color = (200, 20, 150)
        else:
            line_color = (255, 240, 0)      # Electric Cyan
            dot_color = (255, 255, 255)
            glow_color = (200, 180, 0)

        connections = [
            (0, 1), (1, 2), (2, 3), (3, 4),
            (0, 5), (5, 6), (6, 7), (7, 8),
            (0, 9), (9, 10), (10, 11), (11, 12),
            (0, 13), (13, 14), (14, 15), (15, 16),
            (0, 17), (17, 18), (18, 19), (19, 20),
            (5, 9), (9, 13), (13, 17)
        ]

        # Draw glowing lines
        for p1, p2 in connections:
            cv2.line(frame, pts[p1], pts[p2], glow_color, 5, cv2.LINE_AA)
            cv2.line(frame, pts[p1], pts[p2], line_color, 2, cv2.LINE_AA)

        # Draw all 21 joint dots
        for idx, pt in enumerate(pts):
            is_tip = idx in (4, 8, 12, 16, 20)
            radius = 7 if is_tip else 5
            cv2.circle(frame, pt, radius + 2, glow_color, -1, cv2.LINE_AA)
            cv2.circle(frame, pt, radius - 1, dot_color, -1, cv2.LINE_AA)

    def _classify_hand(self, pts):
        wrist = pts[0]
        def is_ext(tip_idx, pip_idx):
            d_tip = math.hypot(pts[tip_idx][0] - wrist[0], pts[tip_idx][1] - wrist[1])
            d_pip = math.hypot(pts[pip_idx][0] - wrist[0], pts[pip_idx][1] - wrist[1])
            return d_tip > d_pip * 1.15

        index_ext = is_ext(8, 6)
        middle_ext = is_ext(12, 10)
        ring_ext = is_ext(16, 14)
        pinky_ext = is_ext(20, 18)

        if index_ext and middle_ext and ring_ext and pinky_ext:
            return "BLUE"
        elif index_ext and not middle_ext and not ring_ext and not pinky_ext:
            return "RED"
        return "NONE"

    def _update_state(self, hands, now, dt, w, h):
        if len(hands) == 0:
            self.state = "NEUTRAL"
            return

        if len(hands) >= 2:
            p1 = hands[0]['palm']
            p2 = hands[1]['palm']
            dist = math.hypot(p1[0] - p2[0], p1[1] - p2[1]) / w

            if dist < 0.28:
                if self.state != "CHARGING_PURPLE" and self.state != "HOLLOW_PURPLE_READY":
                    self.state = "CHARGING_PURPLE"
                    self.purple_start_time = now

                if self.state == "CHARGING_PURPLE":
                    self.purple_progress = min(1.0, (now - self.purple_start_time) / 1.5)
                    if self.purple_progress >= 1.0:
                        self.state = "HOLLOW_PURPLE_READY"
                return

        # Single active hand
        primary = hands[0]
        if primary['gesture'] == "BLUE":
            self.state = "BLUE"
        elif primary['gesture'] == "RED":
            self.state = "RED"
        else:
            self.state = "NEUTRAL"

    def _render_vfx(self, frame, hands, dt):
        if self.state == "BLUE" and len(hands) > 0:
            target = hands[0]['palm']
            # Blue Singularity Core
            cv2.circle(frame, target, 35, (255, 120, 0), -1, cv2.LINE_AA)
            cv2.circle(frame, target, 15, (255, 255, 255), -1, cv2.LINE_AA)
            # Inward spiraling particles
            for _ in range(4):
                a = random.uniform(0, math.pi * 2)
                r = random.uniform(50, 120)
                px = target[0] + int(math.cos(a) * r)
                py = target[1] + int(math.sin(a) * r)
                vx = (target[0] - px) * 3.5
                vy = (target[1] - py) * 3.5
                self.particles.append(Particle(px, py, vx, vy, (255, 220, 0), random.randint(4, 8), 0.4))

        elif self.state == "RED" and len(hands) > 0:
            target = hands[0]['pts'][8] # Index fingertip
            # Red Core
            cv2.circle(frame, target, 28, (30, 0, 255), -1, cv2.LINE_AA)
            cv2.circle(frame, target, 12, (255, 255, 255), -1, cv2.LINE_AA)
            # Outward repulsive blasts
            for _ in range(5):
                a = random.uniform(0, math.pi * 2)
                speed = random.uniform(150, 350)
                vx = math.cos(a) * speed
                vy = math.sin(a) * speed
                self.particles.append(Particle(target[0], target[1], vx, vy, (50, 50, 255), random.randint(4, 7), 0.35))

        elif "PURPLE" in self.state and len(hands) >= 2:
            mid = (
                (hands[0]['palm'][0] + hands[1]['palm'][0]) // 2,
                (hands[0]['palm'][1] + hands[1]['palm'][1]) // 2
            )
            # Massive Purple Core
            cv2.circle(frame, mid, 60, (200, 20, 180), -1, cv2.LINE_AA)
            cv2.circle(frame, mid, 25, (255, 255, 255), -1, cv2.LINE_AA)
            for _ in range(8):
                a = random.uniform(0, math.pi * 2)
                r = random.uniform(40, 100)
                px = mid[0] + int(math.cos(a) * r)
                py = mid[1] + int(math.sin(a) * r)
                self.particles.append(Particle(px, py, 0, 0, (255, 100, 220), random.randint(5, 10), 0.4))

        # Update and draw particles
        surviving = []
        for p in self.particles:
            if p.update(dt):
                cv2.circle(frame, (int(p.x), int(p.y)), p.size, p.color, -1, cv2.LINE_AA)
                surviving.append(p)
        self.particles = surviving

    def _draw_hud(self, frame):
        # Technique Banner
        title = f"TECHNIQUE: {self.state}"
        color = (255, 255, 255)
        if self.state == "BLUE":
            color = (255, 220, 0)
        elif self.state == "RED":
            color = (50, 50, 255)
        elif "PURPLE" in self.state:
            color = (255, 60, 200)

        cv2.putText(frame, title, (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, color, 2, cv2.LINE_AA)
        cv2.putText(frame, f"FPS: {self.fps}", (30, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1, cv2.LINE_AA)


if __name__ == "__main__":
    app = GojoARDesktop()
    app.run()
