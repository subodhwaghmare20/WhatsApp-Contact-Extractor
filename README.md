# WhatsApp Group Contact Extractor & Excel Automation

A browser automation tool built with **Node.js**, **Playwright**, and **ExcelJS** that automates the collection of WhatsApp group participant names and mobile numbers directly from WhatsApp Web into formatted Excel spreadsheets.

---

## 🌟 Key Features

- **Persistent Session & Manual QR Scan:** Uses Playwright persistent context stored locally in `./whatsapp-session`. Scan once with your phone; your session remains authenticated across application restarts.
- **Dynamic Virtual Scroll Handling:** Automatically detects WhatsApp Web's virtualized participant list, scrolling continuously to extract large groups without missing dynamically recycled DOM elements.
- **Saved & Unsaved Contact Support:**
  - **Unsaved Numbers:** Extracts phone numbers directly with international country codes preserved. Detects profile push names (`~Name`).
  - **Saved Contacts & Profile Inspection:** Automatically opens contact cards/drawers for saved contacts whose numbers are hidden in the initial group list, retrieving their visible mobile numbers.
  - **Hidden / Restricted Numbers:** Marks numbers that cannot be viewed as `Not Available` without guessing or hallucinating digits.
- **Intelligent Deduplication:** Removes duplicate participants and duplicate phone numbers automatically.
- **Professional Excel Reports (ExcelJS):**
  - Columns: `Sr. No.`, `Participant Name`, `Mobile Number`, `Contact Status`, `Extraction Status`.
  - Group metadata and statistical summary header.
  - Frozen header row and AutoFilter enabled across all columns.
  - Cell borders, styled headers, and alternate row shading.
  - Phone numbers stored with explicit text format (`@`) to prevent Excel from stripping leading `+` signs or converting to scientific notation.
- **Modern Responsive Dashboard:** Built with HTML5/CSS3/JavaScript, featuring connection badges, live extraction counters, search/filter table preview, and one-click Excel download.
- **Privacy & Safety First:** Runs 100% locally on your machine. Does not automate messaging, does not use banned unofficial API wrappers, and does not compromise credentials.

---

## 🏗️ Project Architecture

```
whatsapp-contact-extractor/
├── src/
│   ├── browser/
│   │   └── whatsappBrowser.js      # Playwright persistent Chromium controller
│   ├── extractor/
│   │   └── participantExtractor.js  # DOM inspector, drawer/modal opener, virtual scroller
│   ├── services/
│   │   ├── dataProcessor.js        # Phone normalization, deduplication, summary stats
│   │   └── excelService.js         # ExcelJS workbook styler, table generator, file exporter
│   ├── ui/
│   │   ├── index.html              # Responsive web dashboard
│   │   ├── style.css               # Clean modern styling
│   │   └── app.js                  # Frontend controller & SSE live event consumer
│   ├── utils/
│   │   └── logger.js               # Formatted terminal logger
│   └── server.js                   # Express server coordinating browser & extraction API
├── test/
│   ├── phase1-check.js             # Dependency import test
│   ├── test-dataprocessor.js       # Data normalization & deduplication unit tests
│   ├── test-excel.js               # Excel workbook structure & styling tests
│   ├── test-error-handling.js      # Error scenarios & malformed input tests
│   ├── test-server-endpoints.js    # Express HTTP routes test
│   └── test-browser-launch.js      # Headless Playwright launch & QR detection test
├── exports/                        # Output folder for generated .xlsx spreadsheets
├── whatsapp-session/               # Local user profile directory (git-ignored)
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** v18+ (tested on v24.22.1)
- **Google Chrome** or Playwright Chromium

### 2. Installation
```powershell
# Install Node.js dependencies
npm install

# Install Playwright browser binary
npx playwright install chromium
```

### 3. Run Automated Tests
```powershell
npm test
```

### 4. Start the Application
```powershell
npm start
```
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 📖 Step-by-Step User Workflow

1. **Launch Browser:** On the dashboard (`http://localhost:3000`), click **"Launch Browser"**. A Chromium window will open at `https://web.whatsapp.com/`.
2. **Authenticate:** If not already logged in, scan the QR code using your WhatsApp mobile app (**Settings > Linked Devices > Link a Device**). Once logged in, your session is saved locally in `./whatsapp-session`.
3. **Select Group:** In the WhatsApp Web window, click and open the target WhatsApp group chat you wish to extract.
4. **Start Extraction:** Return to the dashboard and click **"Start Extraction"**. The automation will:
   - Verify the selected chat is a group.
   - Open the Group Info drawer / "View all" participants modal.
   - Incrementally scroll through the virtual list and stream live participant counts.
   - Normalize numbers and remove duplicates.
5. **Preview & Search:** Review the extracted participants directly in the dashboard table. Use the search bar or filter by contact status (`Saved`, `Unsaved`, `Unknown`).
6. **Export to Excel:** Click **"Export to Excel"** to download the structured workbook (`WhatsApp_Group_Contacts_<GroupName>_YYYY-MM-DD.xlsx`).

---

## 🛡️ Privacy & Technical Limitations

- **Community / Announcement Masking:** In certain WhatsApp Announcement Communities, phone numbers are masked by WhatsApp servers for non-admin accounts. The extractor respects this restriction and marks them as `Not Available`.
- **Saved Contacts Without Displayed Numbers:** If a contact is saved in your phonebook and WhatsApp Web displays only their contact name without rendering the phone number in the DOM, the extractor retains the name and marks the number as `Not Available`.
- **Passive Browser Automation:** Does not inject unauthorized socket code or automate outbound chat messages, ensuring compliance with WhatsApp security policies.

---

## 📄 Copyright & Ownership

**Copyright &copy; 2026 QSpiders Coimbatore. All Rights Reserved.**
Designed and maintained for automated contact extraction and reporting.


