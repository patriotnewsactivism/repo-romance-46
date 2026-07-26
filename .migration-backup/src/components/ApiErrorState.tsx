import React from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import { AlertCircle, RefreshCw, AlertTriangle, AlertOctagon } from 'lucide-react';

interface ApiErrorStateProps {
  error: Error;
  retryFunction: () => void;
  description?: string;
}

export const ApiErrorState: React.FC<ApiErrorStateProps> = ({ error, retryFunction, description }) => {
  const getErrorSeverity = (): 'error' | 'warning' | 'info' => {
    if (error.message.includes('404')) return 'warning';
    if (error.message.includes('500')) return 'error';
    return 'info';
  };

  const getIcon = () => {
    const severity = getErrorSeverity();
    switch (severity) {
      case 'error': return <AlertOctagon className="h-6 w-6 text-destructive" />;
      case 'warning': return <AlertTriangle className="h-6 w-6 text-warning" />;
      default: return <AlertCircle className="h-6 w-6 text-info" />;
    }
  };

  const handleReportIssue = () => {
    window.open('https://feedback.example.com', '_blank');
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2">
          {getIcon()}
          <CardTitle className="text-lg">API Error</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {description && (
          <p className="text-sm text-muted-foreground mb-4">{description}</p>
        )}
        <p className="text-sm break-words">{error.message}</p>
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row gap-2">
        <Button
          variant="outline"
          onClick={retryFunction}
          className="w-full sm:w-auto"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
        <Button
          variant="secondary"
          onClick={handleReportIssue}
          className="w-full sm:w-auto"
        >
          Report Issue
        </Button>
      </CardFooter>
    </Card>
  );
};
