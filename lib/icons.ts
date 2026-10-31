import {
  Link as LinkIcon, Globe, Instagram, Twitter, Youtube, Github, Twitch,
  Linkedin, Facebook, Music, Mail, Send, Mic, Camera, Gamepad2, ShoppingBag,
  Heart, Star, MessageCircle, Briefcase, BookOpen, Coffee, Podcast, Film,
  type LucideIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  link: LinkIcon,
  globe: Globe,
  instagram: Instagram,
  twitter: Twitter,
  youtube: Youtube,
  github: Github,
  twitch: Twitch,
  linkedin: Linkedin,
  facebook: Facebook,
  music: Music,
  mail: Mail,
  send: Send,
  mic: Mic,
  camera: Camera,
  gamepad: Gamepad2,
  shop: ShoppingBag,
  heart: Heart,
  star: Star,
  chat: MessageCircle,
  work: Briefcase,
  blog: BookOpen,
  coffee: Coffee,
  podcast: Podcast,
  film: Film,
};

export const ICON_OPTIONS = Object.keys(ICONS).map((key) => ({
  value: key,
  label: key.charAt(0).toUpperCase() + key.slice(1),
}));

export function getIcon(name: string): LucideIcon {
  return ICONS[name] ?? LinkIcon;
}
