export type BackgroundType = "image" | "video" | "color";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  background_url: string | null;
  background_type: BackgroundType;
  theme_color: string;
  accent_color: string;
  music_url: string | null;
  custom_cursor_url: string | null;
  views: number;
  created_at: string;
}

export type ProfileInput = Omit<Profile, "id" | "created_at" | "views">;

export interface LinkItem {
  id: string;
  user_id: string;
  title: string;
  url: string;
  icon: string;
  position: number;
  is_active: boolean;
  clicks: number;
  created_at: string;
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}
