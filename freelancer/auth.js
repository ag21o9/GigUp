import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prisma.config.js';
import { uploadImage, deleteImage } from '../utils/cloudinary.js';
import { setCache, getCache } from '../utils/redis.js';

// Helper function to generate JWT token
const generateToken = (userId, role) => {
    return jwt.sign(
        { userId, role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
};

// Helper function to validate email
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// POST /api/freelancer/signup
export const signup = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            age,
            skills,
            experience,
            hourlyRate,
            githubUrl,
            linkedinUrl,
            portfolioUrl,
            bio,
            location
        } = req.body;

        // Validation
        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Name, email, and password are required'
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Handle profile image upload if provided
        let profileImageUrl = null;
        if (req.file) {
            const uploadResult = await uploadImage(req.file.buffer, 'freelancer-profiles');
            if (uploadResult.success) {
                profileImageUrl = uploadResult.url;
            }
        }

        // Create user and freelancer profile in a transaction
        const result = await prisma.$transaction(async (tx) => {
            // Create user
            const user = await tx.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    role: 'FREELANCER',
                    profileImage: profileImageUrl,
                    bio,
                    location
                }
            });

            // Create freelancer profile
            const freelancer = await tx.freelancer.create({
                data: {
                    userId: user.id,
                    age: age ? parseInt(age) : null,
                    skills: skills ? skills.split(',').map(skill => skill.trim()) : [],
                    experience,
                    hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null,
                    githubUrl,
                    linkedinUrl,
                    portfolioUrl
                }
            });

            return { user, freelancer };
        });

        // Generate JWT token
        const token = generateToken(result.user.id, result.user.role);

        // Remove password from response
        const { password: _, ...userWithoutPassword } = result.user;

        res.status(201).json({
            success: true,
            message: 'Freelancer account created successfully',
            data: {
                user: userWithoutPassword,
                freelancer: result.freelancer,
                token
            }
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// POST /api/freelancer/login
export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const cacheKey = `freelancer:login:${email}`;

        // Check cache
        const cachedUser = await getCache(cacheKey);
        if (cachedUser) {
            return res.status(200).json({
                success: true,
                message: 'Login successful',
                data: cachedUser
            });
        }

        // Fetch user from database
        const user = await prisma.user.findUnique({
            where: { email },
            include: {
                freelancer: true
            }
        });

        if (!user || user.role !== 'FREELANCER') {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials or not a freelancer account'
            });
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Generate JWT token
        const token = generateToken(user.id, user.role);

        const responseData = {
            user: { ...user, password: undefined },
            token
        };

        // Cache the login data
        await setCache(cacheKey, responseData, 600); // Cache for 10 minutes

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: responseData
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// PUT /api/freelancer/profile
export const updateProfile = async (req, res) => {
    try {
        const userId = req.user.userId; // From auth middleware
        const {
            name,
            bio,
            location,
            age,
            skills,
            experience,
            hourlyRate,
            availability,
            githubUrl,
            linkedinUrl,
            portfolioUrl
        } = req.body;

        // Check if user exists and is a freelancer
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            include: { freelancer: true }
        });

        if (!existingUser || existingUser.role !== 'FREELANCER') {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        // Handle profile image upload if provided
        let profileImageUrl = existingUser.profileImage;
        if (req.file) {
            // Delete old image if it exists
            if (existingUser.profileImage) {
                // Extract public_id from Cloudinary URL and delete
                const publicId = existingUser.profileImage.split('/').slice(-2).join('/').split('.')[0];
                await deleteImage(publicId);
            }

            const uploadResult = await uploadImage(req.file.buffer, 'freelancer-profiles');
            if (uploadResult.success) {
                profileImageUrl = uploadResult.url;
            }
        }

        // Update user and freelancer profile in a transaction
        const result = await prisma.$transaction(async (tx) => {
            // Update user
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    ...(name && { name }),
                    ...(bio !== undefined && { bio }),
                    ...(location !== undefined && { location }),
                    ...(profileImageUrl && { profileImage: profileImageUrl })
                }
            });

            // Update freelancer profile
            const updatedFreelancer = await tx.freelancer.update({
                where: { userId },
                data: {
                    ...(age && { age: parseInt(age) }),
                    ...(skills && { skills: skills.split(',').map(skill => skill.trim()) }),
                    ...(experience !== undefined && { experience }),
                    ...(hourlyRate && { hourlyRate: parseFloat(hourlyRate) }),
                    ...(availability !== undefined && { availability: Boolean(availability) }),
                    ...(githubUrl !== undefined && { githubUrl }),
                    ...(linkedinUrl !== undefined && { linkedinUrl }),
                    ...(portfolioUrl !== undefined && { portfolioUrl })
                }
            });

            return { user: updatedUser, freelancer: updatedFreelancer };
        });

        // Remove password from response
        const { password: _, ...userWithoutPassword } = result.user;

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                user: userWithoutPassword,
                freelancer: result.freelancer
            }
        });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// GET /api/freelancer/profile
export const getProfile = async (req, res) => {
    try {
        const userId = req.user.userId; // From auth middleware

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                freelancer: {
                    include: {
                        assignedProjects: {
                            include: {
                                client: {
                                    include: {
                                        user: {
                                            select: {
                                                name: true,
                                                email: true,
                                                profileImage: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!user || user.role !== 'FREELANCER') {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        // Remove password from response
        const { password: _, ...userWithoutPassword } = user;

        res.status(200).json({
            success: true,
            data: userWithoutPassword
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// PUT /api/freelancer/availability
export const updateAvailability = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { availability } = req.body;

        if (availability === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Availability status is required'
            });
        }

        const updatedFreelancer = await prisma.freelancer.update({
            where: { userId },
            data: { availability: Boolean(availability) }
        });

        res.status(200).json({
            success: true,
            message: 'Availability updated successfully',
            data: { availability: updatedFreelancer.availability }
        });

    } catch (error) {
        console.error('Update availability error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};