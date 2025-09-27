# TypeScript Coding Standards & Best Practices

## 🎯 Overview
This document outlines universal coding standards and best practices that can be applied to any TypeScript project. These guidelines promote maintainable, secure, and high-quality code following SOLID principles and clean code practices.

---

## 🚨 FUNDAMENTAL DEVELOPMENT RULES

### 1. Precision Rule
**Do EXACTLY what is asked - no more, no less.**
- ✅ 1 file requested = 1 file created
- ❌ Don't create extra files "to help"
- ✅ Follow exact specifications
- 🎯 **Focus**: Solve the specific problem without scope creep

---

## ⛔ GIT SAFETY STANDARDS

### 🚫 FORBIDDEN GIT COMMANDS (Data Destruction Prevention)
**NEVER USE THESE COMMANDS - THEY DESTROY WORK:**

- ❌ **`git reset --hard`** - DESTROYS ALL UNCOMMITTED CHANGES
- ❌ **`git reset --hard HEAD~1`** - DESTROYS COMMITS AND CHANGES
- ❌ **`git clean -fd`** - DELETES ALL UNTRACKED FILES
- ❌ **`git checkout HEAD~1 -- .`** - OVERWRITES ALL CURRENT WORK
- ❌ **`git restore --staged --worktree .`** - DESTROYS STAGED AND WORKING CHANGES

### ✅ SAFE ALTERNATIVES
- ✅ **`git reset HEAD`** - Only unstage files (preserves changes)
- ✅ **`git checkout -- specific_file.ts`** - Restore specific files only when needed
- ✅ **`git stash`** - Temporarily save changes without losing them
- ✅ **`git commit -m "WIP: temporary save"`** - Save work in progress
- ✅ **`git revert <commit>`** - Create new commit that undoes changes (safe)

### 🛡️ WORK PRESERVATION PROTOCOL
1. **Before ANY git operation**: Check `git status` first
2. **If unsure**: Create backup commit with `git commit -m "backup before changes"`
3. **Never assume**: Always verify what a git command does before running it
4. **When debugging**: Use `git stash` to save work, never destructive resets
5. **If something breaks**: Fix the issue, don't destroy the work

**REMEMBER**: It's better to have messy commits than to lose hours of work!

---

## 🏗️ CODE QUALITY STANDARDS

### TODO Management Rule
**NO TODO comments should remain in source code.**
- ❌ **NEVER** leave `TODO:`, `TODO-`, `FIXME:`, or similar comments in code
- ✅ **ALWAYS** implement all functionality immediately
- ✅ **If incomplete**: Document as "Next Steps" in reports or documentation
- ✅ **If complex**: Break into smaller tasks and complete in current session
- ✅ **If requires future work**: Add to project documentation, not source code
- 🎯 **Code should always be production-ready** - no placeholder comments

### TypeScript Standards

#### Type Safety
- **Strict Mode**: Always use strict TypeScript configuration
- **No Any Types**: Avoid `any` types - use proper type definitions
- **Interface Definitions**: Define clear interfaces for all data structures
- **Null Safety**: Use optional chaining (`?.`) and nullish coalescing (`??`)
- **Error Types**: Create specific error interfaces instead of generic Error objects

#### Import/Export Consistency
- **ES Modules**: Use ES2022 modules consistently
- **File Extensions**: Use `.js` extensions in imports for compiled output compatibility
- **Barrel Exports**: Use index files to create clean module boundaries
- **Named Exports**: Prefer named exports over default exports for better refactoring

```typescript
// ✅ Good - Proper interface definition
interface UserResponse {
  id: string;
  name: string;
  email?: string;
  metadata: Record<string, unknown>;
}

// ✅ Good - Import with .js extension
import { UserService } from './services/user.js';

// ❌ Bad - Using any type
const userData: any = response.data;

// ❌ Bad - No error handling types
throw new Error('Something went wrong');

// ✅ Good - Typed error handling
interface ValidationError {
  field: string;
  message: string;
  code: 'REQUIRED' | 'INVALID_FORMAT' | 'TOO_LONG';
}

throw new ValidationError({
  field: 'email',
  message: 'Invalid email format',
  code: 'INVALID_FORMAT'
});
```

---

## ⚡ ASYNC/AWAIT BEST PRACTICES

### Error Handling Standards
- **Always Wrap**: Every async operation must be in try-catch blocks
- **Promise Chains**: Prefer async/await over `.then()` chains
- **Concurrent Operations**: Use `Promise.all()` for independent parallel operations
- **Timeout Protection**: Implement timeouts for all external API calls
- **Rate Limiting**: Built-in delays and retry logic for provider rate limits

### Implementation Examples

```typescript
// ✅ Good - Proper error handling with timeout
async function fetchUserData(userId: string): Promise<User | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    const response = await fetch(`/api/users/${userId}`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new APIError(`Failed to fetch user: ${response.status}`);
    }
    
    return await response.json() as User;
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.warn(`Request timeout for user ${userId}`);
      return null;
    }
    logger.error('Failed to fetch user data:', error);
    throw error;
  }
}

// ✅ Good - Concurrent operations
async function loadUserProfile(userId: string): Promise<UserProfile> {
  try {
    const [user, preferences, activity] = await Promise.all([
      fetchUser(userId),
      fetchUserPreferences(userId),
      fetchUserActivity(userId)
    ]);
    
    return {
      user,
      preferences,
      recentActivity: activity.slice(0, 10)
    };
  } catch (error) {
    logger.error('Failed to load user profile:', error);
    throw new ProfileLoadError(`Could not load profile for user ${userId}`);
  }
}

// ❌ Bad - Sequential await (slower)
async function loadUserProfileBad(userId: string): Promise<UserProfile> {
  const user = await fetchUser(userId);
  const preferences = await fetchUserPreferences(userId);
  const activity = await fetchUserActivity(userId);
  
  return { user, preferences, recentActivity: activity };
}

// ✅ Good - Retry logic with exponential backoff
async function fetchWithRetry<T>(
  operation: () => Promise<T>, 
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms:`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('Retry logic failed'); // This should never be reached
}
```

---

## 🛡️ ERROR HANDLING & RESILIENCE

### Multi-Level Fallback Strategy

Implement multiple levels of error recovery to ensure applications remain functional even when components fail.

```typescript
// ✅ 6-Level JSON Parsing Fallback Strategy
function parseJsonWithFallbacks(jsonString: string): any {
  // Strategy 1: Direct JSON parsing
  try {
    return JSON.parse(jsonString);
  } catch {
    // Continue to fallback strategies
  }
  
  // Strategy 2: Clean ```json``` blocks  
  try {
    const cleaned = jsonString.replace(/```json\n?/g, '').replace(/\n?```/g, '');
    return JSON.parse(cleaned);
  } catch {
    // Continue to fallback strategies
  }
  
  // Strategy 3: Regex extraction for embedded JSON
  try {
    const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Continue to fallback strategies
  }
  
  // Strategy 4: Brace matching with string handling
  try {
    const start = jsonString.indexOf('{');
    const end = jsonString.lastIndexOf('}') + 1;
    if (start >= 0 && end > start) {
      return JSON.parse(jsonString.substring(start, end));
    }
  } catch {
    // Continue to fallback strategies
  }
  
  // Strategy 5: Smart fallback with text analysis
  try {
    const lines = jsonString.split('\n');
    const jsonLines = lines.filter(line => 
      line.trim().startsWith('{') || 
      line.trim().startsWith('"') || 
      line.trim().includes(':')
    );
    return JSON.parse(jsonLines.join('\n'));
  } catch {
    // Continue to final fallback
  }
  
  // Strategy 6: Basic fallback creating structured response
  logger.warn('All JSON parsing strategies failed, creating fallback response');
  return {
    result: jsonString,
    parsed: false,
    fallback: true
  };
}

// ✅ Good - Graceful degradation pattern
interface ServiceResponse<T> {
  data?: T;
  error?: string;
  fallback: boolean;
}

async function getDataWithFallback<T>(
  primaryService: () => Promise<T>,
  fallbackService?: () => Promise<T>
): Promise<ServiceResponse<T>> {
  try {
    const data = await primaryService();
    return { data, fallback: false };
  } catch (primaryError) {
    logger.warn('Primary service failed:', primaryError);
    
    if (fallbackService) {
      try {
        const data = await fallbackService();
        return { data, fallback: true };
      } catch (fallbackError) {
        logger.error('Fallback service also failed:', fallbackError);
      }
    }
    
    return { 
      error: `Service unavailable: ${primaryError.message}`, 
      fallback: true 
    };
  }
}
```

### Timeout Implementation

```typescript
// ✅ Good - Comprehensive timeout wrapper
async function withTimeout<T>(
  operation: Promise<T>, 
  timeoutMs: number,
  errorMessage?: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  
  return Promise.race([operation, timeout]);
}

// Usage
const result = await withTimeout(
  fetchUserData('123'), 
  5000, 
  'User data fetch timed out'
);
```

---

## 🏛️ SOLID PRINCIPLES IN PRACTICE

### Single Responsibility Principle (SRP)
Each class/function should have only one reason to change.

```typescript
// ❌ Bad - Multiple responsibilities
class UserManager {
  async createUser(userData: UserData): Promise<User> {
    // Validation
    if (!userData.email || !userData.email.includes('@')) {
      throw new Error('Invalid email');
    }
    
    // Database save
    const user = await database.users.create(userData);
    
    // Send email
    await emailService.sendWelcomeEmail(user.email);
    
    // Log activity
    console.log(`User created: ${user.id}`);
    
    return user;
  }
}

// ✅ Good - Separated responsibilities
class UserValidator {
  validate(userData: UserData): ValidationResult {
    const errors: string[] = [];
    
    if (!userData.email || !userData.email.includes('@')) {
      errors.push('Invalid email format');
    }
    
    if (!userData.name || userData.name.length < 2) {
      errors.push('Name must be at least 2 characters');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

class UserRepository {
  async create(userData: UserData): Promise<User> {
    return await database.users.create(userData);
  }
  
  async findById(id: string): Promise<User | null> {
    return await database.users.findById(id);
  }
}

class UserService {
  constructor(
    private validator: UserValidator,
    private repository: UserRepository,
    private emailService: EmailService,
    private logger: Logger
  ) {}
  
  async createUser(userData: UserData): Promise<User> {
    const validation = this.validator.validate(userData);
    if (!validation.isValid) {
      throw new ValidationError(validation.errors);
    }
    
    const user = await this.repository.create(userData);
    
    await this.emailService.sendWelcomeEmail(user.email);
    this.logger.info(`User created: ${user.id}`);
    
    return user;
  }
}
```

### Open/Closed Principle (OCP)
Classes should be open for extension, closed for modification.

```typescript
// ✅ Good - Extensible notification system
interface NotificationChannel {
  send(message: string, recipient: string): Promise<boolean>;
}

class EmailNotification implements NotificationChannel {
  async send(message: string, recipient: string): Promise<boolean> {
    // Email sending logic
    return await emailService.send(recipient, message);
  }
}

class SMSNotification implements NotificationChannel {
  async send(message: string, recipient: string): Promise<boolean> {
    // SMS sending logic
    return await smsService.send(recipient, message);
  }
}

class NotificationService {
  private channels: NotificationChannel[] = [];
  
  addChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
  }
  
  async notify(message: string, recipient: string): Promise<boolean[]> {
    return Promise.all(
      this.channels.map(channel => channel.send(message, recipient))
    );
  }
}

// Usage - can add new channels without modifying existing code
const notificationService = new NotificationService();
notificationService.addChannel(new EmailNotification());
notificationService.addChannel(new SMSNotification());
// Later: notificationService.addChannel(new SlackNotification());
```

### Dependency Inversion Principle (DIP)
Depend on abstractions, not concretions.

```typescript
// ✅ Good - Dependency injection with interfaces
interface Logger {
  info(message: string): void;
  error(message: string, error?: Error): void;
  warn(message: string): void;
}

interface UserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<User>;
}

interface EmailService {
  sendEmail(to: string, subject: string, body: string): Promise<boolean>;
}

class UserService {
  constructor(
    private logger: Logger,
    private userRepository: UserRepository,
    private emailService: EmailService
  ) {}
  
  async updateUserEmail(userId: string, newEmail: string): Promise<User> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      
      user.email = newEmail;
      const updatedUser = await this.userRepository.save(user);
      
      await this.emailService.sendEmail(
        newEmail, 
        'Email Updated', 
        'Your email has been successfully updated'
      );
      
      this.logger.info(`Email updated for user ${userId}`);
      return updatedUser;
      
    } catch (error) {
      this.logger.error(`Failed to update email for user ${userId}`, error);
      throw error;
    }
  }
}

// Implementation classes can be easily swapped
class ConsoleLogger implements Logger {
  info(message: string): void { console.log(`[INFO] ${message}`); }
  error(message: string, error?: Error): void { console.error(`[ERROR] ${message}`, error); }
  warn(message: string): void { console.warn(`[WARN] ${message}`); }
}

class DatabaseUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    return await db.users.findById(id);
  }
  
  async save(user: User): Promise<User> {
    return await db.users.save(user);
  }
}
```

---

## 📐 CLEAN CODE PRINCIPLES

### Naming Conventions

```typescript
// ✅ Good - Descriptive names
const activeUserAccounts = users.filter(user => user.isActive);
const calculateMonthlyRevenue = (transactions: Transaction[]) => { /* ... */ };

// ❌ Bad - Unclear names
const aus = users.filter(u => u.isActive);
const calc = (trans: any[]) => { /* ... */ };

// ✅ Good - Boolean naming
const isUserActive = (user: User) => user.lastLoginDate > thirtyDaysAgo;
const hasPermission = (user: User, action: string) => user.permissions.includes(action);
const canDeletePost = (user: User, post: Post) => user.id === post.authorId;

// ✅ Good - Function naming (verbs)
function validateUserInput(input: unknown): ValidationResult { /* ... */ }
function transformDataToViewModel(data: RawData): ViewModel { /* ... */ }
async function fetchUserPreferences(userId: string): Promise<UserPreferences> { /* ... */ }
```

### Function Design

```typescript
// ✅ Good - Small, focused functions
function calculateTotalPrice(items: CartItem[]): number {
  return items.reduce((total, item) => total + (item.price * item.quantity), 0);
}

function applyDiscount(price: number, discountPercent: number): number {
  return price * (1 - discountPercent / 100);
}

function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency
  }).format(amount);
}

// Usage - Clear composition
const subtotal = calculateTotalPrice(cartItems);
const discountedPrice = applyDiscount(subtotal, 10);
const formattedPrice = formatCurrency(discountedPrice);

// ❌ Bad - Large function doing too much
function processOrder(items: CartItem[], userInfo: UserInfo, paymentInfo: PaymentInfo) {
  // Validation logic (20 lines)
  // Price calculation logic (15 lines) 
  // Payment processing logic (25 lines)
  // Email sending logic (10 lines)
  // Database updates (15 lines)
  // ... 85 lines total
}
```

### Comments and Documentation

```typescript
// ✅ Good - Explain WHY, not WHAT
/**
 * Calculates compound interest using the formula: A = P(1 + r/n)^(nt)
 * 
 * We use this specific algorithm because it provides more accurate results
 * for small interest rates compared to simple approximation methods.
 */
function calculateCompoundInterest(
  principal: number,
  rate: number,
  compoundingPeriods: number,
  time: number
): number {
  return principal * Math.pow(1 + rate / compoundingPeriods, compoundingPeriods * time);
}

// ❌ Bad - Stating the obvious
function calculateCompoundInterest(principal: number, rate: number, compoundingPeriods: number, time: number): number {
  // Calculate the compound interest
  return principal * Math.pow(1 + rate / compoundingPeriods, compoundingPeriods * time);
}

// ✅ Good - Document complex business logic
/**
 * Determines if a user qualifies for premium features.
 * 
 * Business rule: Users qualify if they have been active for 30+ days
 * AND (have made 5+ purchases OR have a subscription plan).
 * This logic was established in ticket #FEATURE-123.
 */
function qualifiesForPremium(user: User): boolean {
  const isActiveUser = daysSinceRegistration(user) >= 30;
  const hasEnoughPurchases = user.purchaseCount >= 5;
  const hasSubscription = user.subscriptionPlan !== null;
  
  return isActiveUser && (hasEnoughPurchases || hasSubscription);
}
```

---

## 📊 LOGGING AND MONITORING

### Structured Logging

```typescript
interface LogContext {
  userId?: string;
  requestId?: string;
  operation?: string;
  metadata?: Record<string, unknown>;
}

class StructuredLogger implements Logger {
  info(message: string, context?: LogContext): void {
    console.log(JSON.stringify({
      level: 'INFO',
      message,
      timestamp: new Date().toISOString(),
      ...context
    }));
  }
  
  error(message: string, error?: Error, context?: LogContext): void {
    console.error(JSON.stringify({
      level: 'ERROR',
      message,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined,
      timestamp: new Date().toISOString(),
      ...context
    }));
  }
}

// Usage
logger.info('User login successful', {
  userId: '12345',
  requestId: 'req_abc123',
  operation: 'auth.login',
  metadata: { loginMethod: 'email' }
});
```

### Performance Monitoring

```typescript
// ✅ Good - Performance measurement utility
class PerformanceMonitor {
  private static measurements = new Map<string, number>();
  
  static start(operation: string): void {
    this.measurements.set(operation, performance.now());
  }
  
  static end(operation: string): number {
    const startTime = this.measurements.get(operation);
    if (!startTime) {
      throw new Error(`No start time recorded for operation: ${operation}`);
    }
    
    const duration = performance.now() - startTime;
    this.measurements.delete(operation);
    
    // Log if operation takes longer than threshold
    if (duration > 1000) {
      logger.warn(`Slow operation detected: ${operation} took ${duration.toFixed(2)}ms`);
    }
    
    return duration;
  }
  
  static async measure<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    this.start(operation);
    try {
      const result = await fn();
      return result;
    } finally {
      this.end(operation);
    }
  }
}

// Usage
const userData = await PerformanceMonitor.measure('user.fetch', 
  () => userService.fetchUser(userId)
);
```

---

## 🧪 TESTING BEST PRACTICES

### Unit Test Structure

```typescript
describe('UserService', () => {
  let userService: UserService;
  let mockUserRepository: jest.Mocked<UserRepository>;
  let mockEmailService: jest.Mocked<EmailService>;
  let mockLogger: jest.Mocked<Logger>;
  
  beforeEach(() => {
    mockUserRepository = createMockUserRepository();
    mockEmailService = createMockEmailService();
    mockLogger = createMockLogger();
    
    userService = new UserService(
      mockLogger,
      mockUserRepository,
      mockEmailService
    );
  });
  
  describe('updateUserEmail', () => {
    it('should update user email and send confirmation', async () => {
      // Arrange
      const userId = '123';
      const newEmail = 'new@example.com';
      const existingUser = createTestUser({ id: userId, email: 'old@example.com' });
      const updatedUser = { ...existingUser, email: newEmail };
      
      mockUserRepository.findById.mockResolvedValue(existingUser);
      mockUserRepository.save.mockResolvedValue(updatedUser);
      mockEmailService.sendEmail.mockResolvedValue(true);
      
      // Act
      const result = await userService.updateUserEmail(userId, newEmail);
      
      // Assert
      expect(result).toEqual(updatedUser);
      expect(mockUserRepository.findById).toHaveBeenCalledWith(userId);
      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ email: newEmail })
      );
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        newEmail,
        'Email Updated',
        expect.any(String)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Email updated for user ${userId}`)
      );
    });
    
    it('should throw error when user not found', async () => {
      // Arrange
      const userId = '999';
      const newEmail = 'new@example.com';
      mockUserRepository.findById.mockResolvedValue(null);
      
      // Act & Assert
      await expect(
        userService.updateUserEmail(userId, newEmail)
      ).rejects.toThrow('User not found');
      
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });
  });
});
```

---

## ⚡ PERFORMANCE OPTIMIZATION

### Memory Management

```typescript
// ✅ Good - Proper cleanup and resource management
class ResourceManager {
  private connections = new Map<string, Connection>();
  private timers = new Set<NodeJS.Timeout>();
  
  async cleanup(): Promise<void> {
    // Clean up timers
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    
    // Close connections
    await Promise.all(
      Array.from(this.connections.values()).map(conn => conn.close())
    );
    this.connections.clear();
  }
  
  createTimer(callback: () => void, delay: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    
    this.timers.add(timer);
  }
}

// ✅ Good - Efficient data processing
function processLargeDataset<T, R>(
  items: T[], 
  processor: (item: T) => R,
  batchSize: number = 1000
): R[] {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = batch.map(processor);
    results.push(...batchResults);
    
    // Allow event loop to process other tasks
    if (i % (batchSize * 10) === 0) {
      setImmediate(() => {}); // Yield to event loop
    }
  }
  
  return results;
}
```

### Caching Strategies

```typescript
// ✅ Good - LRU Cache implementation
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;
  
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }
  
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, value);
  }
}

// ✅ Good - Memoization pattern
function memoize<T extends (...args: any[]) => any>(fn: T): T {
  const cache = new Map();
  
  return ((...args: Parameters<T>) => {
    const key = JSON.stringify(args);
    
    if (cache.has(key)) {
      return cache.get(key);
    }
    
    const result = fn(...args);
    cache.set(key, result);
    return result;
  }) as T;
}

// Usage
const expensiveCalculation = memoize((a: number, b: number) => {
  // Expensive computation
  return a * b + Math.random() * 1000;
});
```

---

## 🔒 SECURITY BEST PRACTICES

### Input Validation

```typescript
// ✅ Good - Comprehensive input validation
interface ValidationRule<T> {
  validate: (value: T) => boolean;
  message: string;
}

class Validator<T> {
  private rules: ValidationRule<T>[] = [];
  
  addRule(rule: ValidationRule<T>): this {
    this.rules.push(rule);
    return this;
  }
  
  validate(value: T): { isValid: boolean; errors: string[] } {
    const errors = this.rules
      .filter(rule => !rule.validate(value))
      .map(rule => rule.message);
      
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

// Email validation
const emailValidator = new Validator<string>()
  .addRule({
    validate: (email) => email.includes('@'),
    message: 'Email must contain @ symbol'
  })
  .addRule({
    validate: (email) => email.length >= 5,
    message: 'Email must be at least 5 characters'
  })
  .addRule({
    validate: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    message: 'Email must be in valid format'
  });
```

### Secure Error Handling

```typescript
// ✅ Good - Secure error responses
class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
    public isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

function handleError(error: Error): { message: string; statusCode: number } {
  if (error instanceof APIError && error.isOperational) {
    // Safe to expose operational errors
    return {
      message: error.message,
      statusCode: error.statusCode
    };
  }
  
  // Log detailed error internally
  logger.error('Unexpected error:', error);
  
  // Return generic error to client
  return {
    message: 'An unexpected error occurred',
    statusCode: 500
  };
}
```

---

## 📋 CODE REVIEW CHECKLIST

### Pre-Commit Checks
- [ ] All TODO comments removed or documented elsewhere
- [ ] No `console.log` statements in production code
- [ ] All TypeScript strict mode rules satisfied
- [ ] Error handling implemented for all async operations
- [ ] Unit tests written for new functionality
- [ ] Performance considerations addressed
- [ ] Security implications reviewed
- [ ] Documentation updated

### Code Quality Checks
- [ ] Functions are single-purpose and focused
- [ ] Variable and function names are descriptive
- [ ] Code follows established patterns in the project
- [ ] Dependencies are properly injected
- [ ] Interfaces are well-defined
- [ ] Error types are specific and helpful
- [ ] Resource cleanup is handled properly

---

## 🎯 CONCLUSION

These standards promote:
- **Maintainability**: Code that's easy to understand and modify
- **Reliability**: Robust error handling and testing
- **Security**: Safe coding practices and input validation
- **Performance**: Efficient algorithms and resource management
- **Collaboration**: Clear conventions and documentation

**Remember**: These are guidelines, not rigid rules. Apply them with judgment based on your project's specific needs and constraints.

---

*This document is a living standard - update it as new patterns emerge and lessons are learned.*