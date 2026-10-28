"""Generate the engineering SVG; original board photo is embedded unchanged."""
from pathlib import Path
import base64
import html

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
photo = base64.b64encode((WEB / 'board-photo.jpeg').read_bytes()).decode('ascii')
parts = ['''<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1580" viewBox="0 0 1800 1580" role="img" aria-labelledby="title desc">
<title id="title">Physical ESP32-S3 N16R8 board to L298N car wiring</title>
<desc id="desc">Your actual board photograph, component side facing you, antenna up and USB down. GPIO1 to IN1, GPIO14 to IN2, GPIO21 to IN3, GPIO47 to IN4, GPIO41 to ENA and GPIO42 to ENB. Motors on OUT1/2 and OUT3/4. Separate regulated 5V logic and existing 5V motor supply, common ground. Remove ENA, ENB and 5V-EN jumpers. Photograph pin locations are marked directly.</desc>
<defs><style>
text{font-family:Segoe UI,Arial,sans-serif;fill:#eef2fa}.title{font-size:34px;font-weight:700}.heading{font-size:25px;font-weight:650}.label{font-size:22px}.small{font-size:19px;fill:#b8c5d8}.pin{font:22px Consolas,monospace}.wire{fill:none;stroke-width:5;stroke-linejoin:round;stroke-linecap:round}.power{stroke:#ff756c}.ground{stroke:#b9c7d9}.box{fill:#202b3b;stroke:#53647a;stroke-width:2}.note{fill:#302a22;stroke:#cfab6c;stroke-width:2}
</style></defs>
<rect width="1800" height="1580" rx="20" fill="#111925"/>
<text x="38" y="53" class="title">ESP32-S3 N16R8 + L298N / physical connection diagram</text>
<text x="38" y="88" class="small">Same wiring-guide format as the classic ESP32 project • this board uses different GPIO pins</text>
<text x="38" y="132" class="heading">1. YOUR BOARD — FRONT VIEW</text>
<text x="38" y="162" class="small">Antenna UP • USB DOWN • count header pads from the top</text>
<rect x="52" y="177" width="486" height="814" rx="14" fill="#05080d" stroke="#53647a" stroke-width="2"/>
''', f'<image x="55" y="180" width="480" height="808.421" href="data:image/jpeg;base64,{photo}"/>', '''
<text x="900" y="132" class="heading">2. L298N MOTOR DRIVER</text>
<text x="900" y="162" class="small">Module drawing shows terminal names; check your module labels</text>
<rect x="900" y="218" width="410" height="662" rx="18" fill="#572b34" stroke="#bd7181" stroke-width="3"/>
<rect x="944" y="240" width="320" height="78" rx="8" fill="#171c24"/>
<path d="M965 247V310 M990 247V310 M1015 247V310 M1040 247V310 M1065 247V310 M1090 247V310 M1115 247V310 M1140 247V310 M1165 247V310 M1190 247V310 M1215 247V310 M1240 247V310" stroke="#6c7785" stroke-width="6"/>
<text x="935" y="642" class="heading">ENA / ENB: jumpers OFF</text>
<text x="935" y="681" class="label">Separate 5V-EN: OFF</text>
<text x="935" y="719" class="small">External regulated 5 V logic</text>
<text x="935" y="752" class="small">No motor output is permanent GND</text>
<text x="1360" y="270" class="heading">3. TWO-WIRE MOTORS</text>
''']


def text(x, y, value, cls='label', color=None, anchor=None):
    extra = f' style="fill:{color}"' if color else ''
    if anchor:
        extra += f' text-anchor="{anchor}"'
    parts.append(f'<text x="{x}" y="{y}" class="{cls}"{extra}>{html.escape(value)}</text>')


def path(d, color, width=5):
    parts.append(f'<path d="{d}" class="wire" style="stroke:{color};stroke-width:{width}"/>')


def dot(x, y, color, radius=6):
    parts.append(f'<circle cx="{x}" cy="{y}" r="{radius}" fill="{color}"/>')


def pad(x, y, label, color):
    parts.append(f'<circle cx="{x}" cy="{y}" r="10" fill="none" stroke="{color}" stroke-width="4"/>')
    if label != '14':
        parts.append(f'<rect x="{x+19}" y="{y-16}" width="86" height="30" rx="6" fill="#111925" stroke="{color}"/>')
        text(x+62, y+7, label, 'pin', color, 'middle')


scale = 480 / 950
def point(x, y):
    return (round(55 + x * scale, 2), round(180 + y * scale, 2))


# Pad centres measured from the supplied 950x1600 board photograph.
# Positions and GPIO names match the implemented firmware, not classic ESP32.
wires = [
    ('1', 730, 358, 'IN1', 365, '#69dbba', 810),
    ('14', 100, 1378, 'IN2', 405, '#ffb482', 650),
    ('21', 730, 1228, 'IN3', 445, '#d1a3ff', 730),
    ('47', 730, 1168, 'IN4', 485, '#ffe184', 770),
    ('41', 730, 545, 'ENA', 525, '#75c4ff', 690),
    ('42', 730, 480, 'ENB', 565, '#ffa1d0', 610),
]
for label, px, py, target, target_y, color, lane in wires:
    x, y = point(px, py)
    if label == '14':
        path(f'M{x} {y} H30 V1030 H{lane} V{target_y} H900', color)
        parts.append(f'<rect x="37" y="{y-36}" width="98" height="30" rx="6" fill="#111925" stroke="{color}"/>')
        text(86, y-14, 'GPIO14', 'small', color, 'middle')
    else:
        path(f'M{x} {y} H{lane} V{target_y} H900', color)
    pad(x, y, label, color)
    dot(900, target_y, color, 8)
    text(920, target_y+7, target, 'pin', color)

# Motor leads join only their respective OUT terminals.
for output1, output2, y1, y2, name, subtitle, color in [
    ('OUT1','OUT2',355,395,'DRIVE MOTOR','Two motor wires','#69dbba'),
    ('OUT3','OUT4',455,495,'STEERING MOTOR','Two-wire spring return','#d1a3ff'),
]:
    centre = (y1+y2)/2
    text(1210, y1+7, output1, 'pin', color)
    text(1210, y2+7, output2, 'pin', color)
    dot(1310, y1, color)
    dot(1310, y2, color)
    path(f'M1310 {y1} H1370 V{centre-14} H1410 M1310 {y2} H1385 V{centre+14} H1410', color)
    parts.append(f'<circle cx="1445" cy="{centre}" r="35" class="box"/>')
    text(1445, centre+9, 'M', 'heading', None, 'middle')
    text(1500, centre-3, name, 'label')
    text(1500, centre+26, subtitle, 'small')

# Wiring notes stay outside the line-routing area.
parts.append('<rect x="1365" y="610" width="396" height="245" rx="14" class="note"/>')
for y, value, cls in [
    (647,'CONNECT WITH ALL POWER OFF','label'),
    (684,'Remove ENA and ENB jumpers.','small'),
    (716,'Remove the separate 5V-EN jumper.','small'),
    (748,'Never connect 5 V to any ESP GPIO.','small'),
    (780,'10 kΩ pull-downs to GND on','small'),
    (812,'IN1–IN4, ENA and ENB.','small'),
]:
    text(1385, y, value, cls)

# Driver power terminals. Positive and ground networks are deliberately separate.
for x, label in [(1000,'VS / +12V'), (1125,'GND'), (1250,'5V LOGIC')]:
    parts.append(f'<rect x="{x-50}" y="802" width="100" height="78" rx="6" fill="#205e56"/>')
    parts.append(f'<circle cx="{x}" cy="829" r="13" fill="#c4c9c5"/><path d="M{x-9} 829H{x+9}" stroke="#405047" stroke-width="3"/>')
    text(x, 863, label, 'small', None, 'middle')
    dot(x, 880, '#b9c7d9' if label == 'GND' else '#ff756c')

parts.append('<rect x="900" y="1040" width="420" height="120" rx="14" class="box"/>')
text(920, 1078, 'REGULATED 5 V SUPPLY', 'heading')
text(920, 1111, 'Existing motor supply → VS', 'small')
text(920, 1141, 'Regulated 5 V → logic 5V', 'small')
path('M1000 1040 V960 H1250 V880 M1000 960 V880', '#ff756c', 6)
dot(1000, 960, '#ff756c')
text(1050, 990, '+5 V — two separate driver terminals', 'small', '#ffb3ad')
text(930, 925, 'VS uses your 5 V supply, despite its “+12V” label.', 'small')
path('M1125 880 V905 H1360 V1300', '#b9c7d9', 6)
path('M1120 1160 V1300', '#b9c7d9', 6)

# Capacitors near the driver's supply. Dots denote electrical junctions.
path('M1250 960 H1640', '#ff756c', 5)
dot(1250, 960, '#ff756c')
for x, label in [(1500,'100 µF'), (1640,'100 nF')]:
    path(f'M{x} 960 V1020 M{x-22} 1020 H{x+22} M{x-22} 1032 H{x+22} M{x} 1032 V1300', '#b9c7d9', 4)
    path(f'M{x} 960 V1020', '#ff756c', 4)
    dot(x, 960, '#ff756c')
    text(x, 1081, label, 'label', None, 'middle')
    if x == 1500:
        text(x-39, 1018, '+', 'label', '#ffb3ad')
text(1440, 1135, 'Supply decoupling at driver', 'small')
text(1440, 1170, 'Use suitable voltage ratings.', 'small')

# USB power uses one input; neither the header 5V nor 3V3 is a motor supply.
parts.append('<rect x="55" y="1120" width="500" height="110" rx="14" class="box"/>')
text(75, 1158, 'ESP USB POWER — REGULATED 5 V', 'label')
text(75, 1192, 'One USB cable; do not also feed the 5V header.', 'small')
path('M280 1120 V1070 H210 V913', '#ff756c', 6)
text(70, 1016, 'USB cable → ONE connector only', 'small', '#ffb3ad')
path('M120 1230 V1300', '#b9c7d9', 6)

# Actual physical ground pad on the right header, bottommost pad.
gx, gy = point(730, 1425)
path(f'M{gx} {gy} H590 V1300', '#b9c7d9', 6)
pad(gx, gy, 'GND', '#b9c7d9')
path('M55 1300 H1745', '#b9c7d9', 7)
for x in [120,590,1120,1360,1500,1640]:
    dot(x, 1300, '#b9c7d9', 7)
text(55, 1341, 'COMMON GROUND: ESP GND + L298N GND + USB supply negative + motor supply negative', 'label')
text(55, 1376, 'Dots mark joined wires. Crossings without dots are not electrical connections. Route motor current through power wiring.', 'small')

# Position legend makes the photo useful even when printed small.
parts.append('<rect x="40" y="1400" width="1720" height="140" rx="14" class="box"/>')
text(60, 1435, 'PHYSICAL HEADER POSITIONS — look at the front, antenna up', 'label')
for x, y, value in [
    (60,1474,'1 → IN1: right, 3rd from top'),
    (620,1474,'14 → IN2: left, 2nd from bottom'),
    (1180,1474,'21 → IN3: right, 4th from bottom'),
    (60,1512,'47 → IN4: right, 5th from bottom'),
    (620,1512,'41 → ENA: right, 6th from top'),
    (1180,1512,'42 → ENB: right, 5th from top'),
]:
    text(x,y,value,'small')
text(55, 1569, 'OV3660 plugs into the ribbon socket. The board photo is yours; L298N terminal placement is schematic. GPIO mapping matches the S3 firmware.', 'small')
parts.append('</svg>')
(WEB / 'wiring.svg').write_text('\n'.join(parts), encoding='utf-8')
print('Created full physical-board wiring diagram with both motors and power connections.')
