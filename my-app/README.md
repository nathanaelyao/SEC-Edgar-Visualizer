# SEC Edgar Visualizer & Portfolio Tracker

A financial tracking application built with React Native and Expo. Track your stock portfolio, view SEC 13F filings, and visualize historical performance.

## Features

*   **Portfolio Management**: Track your Holdings, Cost Basis, and Realized/Unrealized Gains.
*   **Real-Time Data**: Fetch current stock prices and historical data.
*   **13F Analysis**: Visualize top institutional holdings from SEC Edgar filings.
*   **Touch-Interactive Charts**:
    *   Dynamic Line Charts for Portfolio History.
    *   Bar Charts for Financial Trends (Revenue/Net Income).
    *   Pie Charts for Portfolio Allocation.
*   **Dark Mode Support**: Fully adaptive themes.

## Screenshots

<p float="left">
  <img src="assets/screenshots/home_dashboard.png" width="30%" />
  <img src="assets/screenshots/portfolio_performance.png" width="30%" />
  <img src="assets/screenshots/portfolio_allocation.png" width="30%" />
</p>
<p float="left">
  <img src="assets/screenshots/portfolio_holdings.png" width="30%" />
  <img src="assets/screenshots/portfolio_holding_detail.png" width="30%" />
  <img src="assets/screenshots/stock_price_chart.png" width="30%" /> 
</p>
<p float="left">
  <img src="assets/screenshots/stock_financials.png" width="30%" />
  <img src="assets/screenshots/filings_list.png" width="30%" />
  <img src="assets/screenshots/settings.png" width="30%" />
</p>

## Tech Stack

*   **Frontend**: React Native, Expo, TypeScript
*   **Storage**: Expo SQLite (Local Database)
*   **Data**: Custom SEC API integration (HTML/XML parsing)
*   **Charts**: Custom SVG-based charts (React Native SVG)

## Getting Started

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-username/SEC-Edgar-Visualizer.git
    cd SEC-Edgar-Visualizer
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Run the app**
    ```bash
    npx expo start
    ```

## Development

This project was built using a file-based routing system with `expo-router`.

*   **`app/(tabs)`**: Main navigation tabs (Home, Portfolio, Search, Settings).
*   **`utils/db.ts`**: Local SQLite database management for transactions and snapshots.
*   **`utils/secApi.ts`**: Utilities for fetching and parsing SEC data.
