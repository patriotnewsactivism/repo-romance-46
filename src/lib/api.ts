import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { ErrorBoundary } from 'react-error-boundary';

// Existing API configuration
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'https://api.example.com',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Enhanced error handling
interface ApiError {
  message: string;
  status?: number;
  code?: string;
  details?: any;
}

export const handleApiError = (error: unknown): ApiError => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    return {
      message: axiosError.response?.data?.message || axiosError.message,
      status: axiosError.response?.status,
      code: axiosError.code,
      details: axiosError.response?.data
    };
  }
  
  if (error instanceof Error) {
    return {
      message: error.message
    };
  }
  
  return {
    message: 'An unknown error occurred'
  };
};

// Custom error boundary component
interface ErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

export const ApiErrorBoundary = ({ children }: { children: React.ReactNode }) => (
  <ErrorBoundary
    FallbackComponent={({ error, resetErrorBoundary }: ErrorFallbackProps) => (
      <div className="p-4 bg-red-50 rounded-lg">
        <h3 className="text-lg font-medium text-red-800">API Error</h3>
        <p className="mt-2 text-sm text-red-600">{error.message}</p>
        <button
          onClick={resetErrorBoundary}
          className="mt-4 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    )}
  >
    {children}
  </ErrorBoundary>
);

// Enhanced API request wrapper
const request = async <T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> => {
  try {
    return await api(config);
  } catch (error) {
    throw handleApiError(error);
  }
};

export const get = <T = any>(url: string, config?: AxiosRequestConfig) => request<T>({ ...config, method: 'get', url });

export const post = <T = any>(url: string, data?: any, config?: AxiosRequestConfig) => request<T>({ ...config, method: 'post', url, data });

export const put = <T = any>(url: string, data?: any, config?: AxiosRequestConfig) => request<T>({ ...config, method: 'put', url, data });

export const del = <T = any>(url: string, config?: AxiosRequestConfig) => request<T>({ ...config, method: 'delete', url });
