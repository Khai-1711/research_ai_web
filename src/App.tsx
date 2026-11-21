import React, { useCallback, useEffect, useState } from 'react';
import type { AppSurface, ThemeMode } from './types.ts';
import {
  applyAndSaveTheme,
  loadTheme,
  THEME_STORAGE_KEY,
} from './utils/themeAndExport.ts';
import { ResearchLabApp } from './lab/ResearchLabApp.tsx';
import { FlowMapApp } from './flow/FlowMapApp.tsx';

function readRouteFromLocation(): { surface: AppSurface; roomId?: string } {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room') || undefined;
  return {
    surface: path.startsWith('/flow') ? 'flow' : 'lab',
    roomId,
  };
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const initial = loadTheme();
    applyAndSaveTheme(initial);
    return initial;
  });

  const [route, setRoute] = useState<{ surface: AppSurface; roomId?: string }>(() =>
    readRouteFromLocation()
  );

  // Sync theme automatically across parallel tabs (Interface 1 <-> Interface 2)
  useEffect(() => {
    applyAndSaveTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setTheme(e.newValue);
      }
    };
    const onPopState = () => {
      setRoute(readRouteFromLocation());
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const navigate = useCallback((surface: AppSurface, roomId?: string) => {
    const base = surface === 'flow' ? '/flow' : '/';
    const url = roomId ? `${base}?room=${encodeURIComponent(roomId)}` : base;
    window.history.pushState({}, '', url);
    setRoute({ surface, roomId });
  }, []);

  if (route.surface === 'flow') {
    return (
      <FlowMapApp
        theme={theme}
        onToggleTheme={toggleTheme}
        onSwitchToLab={(roomId) => navigate('lab', roomId)}
        initialRoomId={route.roomId}
      />
    );
  }

  return (
    <ResearchLabApp
      theme={theme}
      onToggleTheme={toggleTheme}
      onSwitchToFlowMap={(roomId) => navigate('flow', roomId)}
      initialRoomId={route.roomId}
    />
  );
}
