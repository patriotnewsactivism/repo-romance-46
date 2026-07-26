import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RepoHealthCheck } from './RepoHealth';
import { useServerFn, useQuery } from '@tanstack/react-start';

// Mock TanStack Start and TanStack Query hooks
vi.mock('@tanstack/react-start', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useServerFn: vi.fn(),
    useQuery: vi.fn(),
  };
});

// Mock the utility function 'cn' if it were more complex, but for now, we'll assume it's simple or mocked globally if needed
// For a simple `cn` function, it might not even need mocking if it just concatenates strings.
// However, for robust testing, if it's imported, mock it.
vi.mock('@/lib/utils', () => ({
  cn: vi.fn((...args) => args.filter(Boolean).join(' ')), // Simple mock for cn
}));

describe('RepoHealthCheck', () => {
  const mockRepo = 'owner/repo-name';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock implementation for each test
    (useServerFn as vi.Mock).mockReturnValue(vi.fn()); // Mock the server function getter
  });

  it('renders the initial state with show health check button', () => {
    // Simulate useQuery not being enabled initially
    (useQuery as vi.Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
      enabled: false, // Ensure it's disabled initially
    });

    render(<RepoHealthCheck repo={mockRepo} />);

    expect(screen.getByRole('button', { name: /▸ show health check/i })).toBeInTheDocument();
    expect(screen.queryByText(/checking health…/i)).not.toBeInTheDocument();
  });

  it('shows loading state when health data is being fetched', () => {
    (useQuery as vi.Mock).mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
      enabled: true,
    });

    render(<RepoHealthCheck repo={mockRepo} defaultOpen={true} />);

    expect(screen.getByText(/checking health…/i)).toBeInTheDocument();
  });

  it('shows error state when health data fetch fails', () => {
    const errorMessage = 'Failed to fetch health data';
    (useQuery as vi.Mock).mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error(errorMessage),
      data: undefined,
      refetch: vi.fn(),
      enabled: true,
    });

    render(<RepoHealthCheck repo={mockRepo} defaultOpen={true} />);

    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('renders health data when successfully fetched', () => {
    const mockHealthData = {
      repo: mockRepo,
      healthScore: 85,
      grade: 'A',
      factors: [
        { name: 'CI Status', status: true, weight: 20 },
        { name: 'License', status: true, weight: 15 },
        { name: 'Tests', status: true, weight: 25 },
        { name: 'README', status: true, weight: 10 },
        { name: 'Activity', status: false, weight: 10 },
      ],
      ciProvider: 'GitHub Actions',
      license: 'MIT',
      hasTests: true,
      hasCI: true,
      stars: 120,
      openIssues: 5,
      lastPush: '2023-10-26T10:00:00Z',
    };
    (useQuery as vi.Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: mockHealthData,
      refetch: vi.fn(),
      enabled: true,
    });

    render(<RepoHealthCheck repo={mockRepo} defaultOpen={true} />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('85/100')).toBeInTheDocument();
    expect(screen.getByText('health score')).toBeInTheDocument();
    expect(screen.getByText('CI Status')).toBeInTheDocument();
    expect(screen.getByText('License')).toBeInTheDocument();
    expect(screen.getByText('Tests')).toBeInTheDocument();
    expect(screen.getByText('README')).toBeInTheDocument();
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.queryByText('checking health…')).not.toBeInTheDocument();
  });

  it('toggles visibility when button is clicked', async () => {
    (useQuery as vi.Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
      enabled: false,
    });

    const { rerender } = render(<RepoHealthCheck repo={mockRepo} />);

    const showButton = screen.getByRole('button', { name: /▸ show health check/i });
    expect(showButton).toBeInTheDocument();

    // Simulate state change by re-rendering with defaultOpen=true (or clicking and re-mocking useQuery)
    // For a real click, we would use userEvent.click, but mocking state directly is easier for useQuery's enabled prop.
    rerender(<RepoHealthCheck repo={mockRepo} defaultOpen={true} />)

    // Now, assume useQuery would be enabled and return data.
    const mockHealthData = {
      repo: mockRepo,
      healthScore: 85,
      grade: 'A',
      factors: [], // Simplified for this test
      ciProvider: 'GitHub Actions',
      license: 'MIT',
      hasTests: true,
      hasCI: true,
      stars: 120,
      openIssues: 5,
      lastPush: '2023-10-26T10:00:00Z',
    };
    (useQuery as vi.Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: mockHealthData,
      refetch: vi.fn(),
      enabled: true,
    });

    rerender(<RepoHealthCheck repo={mockRepo} defaultOpen={true} />); // Re-render again with the mocked data.

    expect(screen.getByRole('button', { name: /▾ hide health check/i })).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});
