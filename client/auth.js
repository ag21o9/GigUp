import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prisma.config.js';
import { setCache, getCache } from '../utils/redis.js';


import { uploadImage, deleteImage } from '../utils/cloudinary.js';

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

// POST /api/client/signup
export const signup = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            companyName,
            industry,
            website,
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
            const uploadResult = await uploadImage(req.file.buffer, 'client-profiles');
            if (uploadResult.success) {
                profileImageUrl = uploadResult.url;
            }
        }

        // Create user and client profile in a transaction
        const result = await prisma.$transaction(async (tx) => {
            // Create user
            const user = await tx.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    role: 'CLIENT',
                    profileImage: profileImageUrl,
                    bio,
                    location
                }
            });

            // Create client profile
            const client = await tx.client.create({
                data: {
                    userId: user.id,
                    companyName,
                    industry,
                    website
                }
            });

            return { user, client };
        });

        // Generate JWT token
        const token = generateToken(result.user.id, result.user.role);

        // Remove password from response
        const { password: _, ...userWithoutPassword } = result.user;

        res.status(201).json({
            success: true,
            message: 'Client account created successfully',
            data: {
                user: userWithoutPassword,
                client: result.client,
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

// POST /api/client/login
export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const cacheKey = `client:login:${email}`;

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
                client: true
            }
        });

        if (!user || user.role !== 'CLIENT') {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials or not a client account'
            });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

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

// PUT /api/client/profile
export const updateProfile = async (req, res) => {
    try {
        const userId = req.user.userId; // From auth middleware
        const {
            name,
            bio,
            location,
            companyName,
            industry,
            website
        } = req.body;

        // Check if user exists and is a client
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            include: { client: true }
        });

        if (!existingUser || existingUser.role !== 'CLIENT') {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Handle profile image upload if provided
        let profileImageUrl = existingUser.profileImage;
        if (req.file) {
            // Delete old image if it exists
            if (existingUser.profileImage) {
                const publicId = existingUser.profileImage.split('/').slice(-2).join('/').split('.')[0];
                await deleteImage(publicId);
            }

            const uploadResult = await uploadImage(req.file.buffer, 'client-profiles');
            if (uploadResult.success) {
                profileImageUrl = uploadResult.url;
            }
        }

        // Update user and client profile in a transaction
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

            // Update client profile
            const updatedClient = await tx.client.update({
                where: { userId },
                data: {
                    ...(companyName !== undefined && { companyName }),
                    ...(industry !== undefined && { industry }),
                    ...(website !== undefined && { website })
                }
            });

            return { user: updatedUser, client: updatedClient };
        });

        // Remove password from response
        const { password: _, ...userWithoutPassword } = result.user;

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                user: userWithoutPassword,
                client: result.client
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

// GET /api/client/profile
export const getProfile = async (req, res) => {
    try {
        const userId = req.user.userId; // From auth middleware

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                client: {
                    include: {
                        projects: {
                            include: {
                                freelancer: {
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
                            },
                            orderBy: {
                                createdAt: 'desc'
                            }
                        }
                    }
                }
            }
        });

        if (!user || user.role !== 'CLIENT') {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
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

// GET /api/client/freelancers
export const getAllFreelancers = async (req, res) => {
    try {
        const { 
            skills, 
            minRating, 
            location, 
            availability, 
            page = 1, 
            limit = 10 
        } = req.query;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const whereClause = {};

        // Filter by availability
        if (availability !== undefined) {
            whereClause.availability = availability === 'true';
        }

        // Filter by minimum rating
        if (minRating) {
            whereClause.ratings = { gte: parseFloat(minRating) };
        }

        // Filter by skills
        if (skills) {
            const skillsArray = skills.split(',').map(skill => skill.trim());
            whereClause.skills = {
                hasSome: skillsArray
            };
        }

        // User location filter
        const userWhereClause = {};
        if (location) {
            userWhereClause.location = {
                contains: location,
                mode: 'insensitive'
            };
        }

        const freelancers = await prisma.freelancer.findMany({
            where: whereClause,
            include: {
                user: {
                    where: userWhereClause,
                    select: {
                        name: true,
                        email: true,
                        profileImage: true,
                        bio: true,
                        location: true,
                        createdAt: true
                    }
                }
            },
            orderBy: {
                ratings: 'desc'
            },
            skip,
            take: parseInt(limit)
        });

        // Filter out freelancers whose users don't match location criteria
        const filteredFreelancers = freelancers.filter(freelancer => freelancer.user);

        const totalFreelancers = await prisma.freelancer.count({
            where: whereClause,
            ...(location && {
                include: {
                    user: {
                        where: userWhereClause
                    }
                }
            })
        });

        res.status(200).json({
            success: true,
            data: {
                freelancers: filteredFreelancers,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalFreelancers,
                    pages: Math.ceil(totalFreelancers / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Get freelancers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};