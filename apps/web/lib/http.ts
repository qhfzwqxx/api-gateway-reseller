import axios, { AxiosError } from "axios";

function resolveHttpBaseUrl() {
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    return "/api";
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4100";
}

function getTokenKey() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) {
    return "gateway_admin_token";
  }

  return "gateway_user_token";
}

function getToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(getTokenKey());
}

function clearToken() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getTokenKey());
}

export const http = axios.create({
  baseURL: resolveHttpBaseUrl(),
  timeout: 30_000,
});

http.interceptors.request.use((config) => {
  const token = getToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ issues?: unknown[] }>) => {
    const status = error.response?.status;
    const data = error.response?.data;

    if (status === 401) {
      clearToken();

      if (typeof window !== "undefined") {
        window.alert("未登录或登录已过期，请重新登录");
        window.location.href = "/login";
      }
    }

    if (status === 403) {
      console.error("非管理员或功能关闭");
    }

    if (status === 400 && Array.isArray(data?.issues)) {
      return Promise.reject(error);
    }

    return Promise.reject(error);
  },
);

export default http;
