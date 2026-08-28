import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider as ReduxProvider } from "react-redux";
import { store } from "@/store";
import { AppShell } from "@/components/AppShell";
import { App } from "@/App";
import "@/globals.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <ReduxProvider store={store}>
                <AppShell>
                    <App />
                </AppShell>
            </ReduxProvider>
        </BrowserRouter>
    </StrictMode>,
);
